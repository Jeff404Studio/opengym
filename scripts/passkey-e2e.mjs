#!/usr/bin/env node
// End-to-end WebAuthn test against the live openGym web origin,
// using Chrome's virtual authenticator (CDP WebAuthn domain).
import fs from 'node:fs'

const ORIGIN = process.env.OPENGYM_ORIGIN || 'https://web-production-07793.up.railway.app'
const PORT = +(process.env.CDP_PORT || 9444)
const OUT = process.env.OUT || '/tmp/passkey-e2e-result.json'

const tabRes = await fetch(`http://127.0.0.1:${PORT}/json/new?${ORIGIN}/`, { method: 'PUT' })
const page = await tabRes.json()
if (!page.webSocketDebuggerUrl) {
  fs.writeFileSync(OUT, JSON.stringify({ fatal: 'no page', page }, null, 2))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

let n = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const data = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id)
    pending.delete(data.id)
    if (data.error) reject(new Error(JSON.stringify(data.error)))
    else resolve(data.result || {})
  }
})

const cdp = (method, params, timeout = 60000) => new Promise((resolve, reject) => {
  const id = ++n
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
  setTimeout(() => {
    if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)) }
  }, timeout)
})

await cdp('Page.enable')
await cdp('Runtime.enable')
await cdp('WebAuthn.enable', { enableUI: false })
const auth = await cdp('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true
  }
})

await cdp('Page.navigate', { url: ORIGIN + '/' })
await new Promise(r => setTimeout(r, 4000))
const ready = await cdp('Runtime.evaluate', {
  expression: 'location.href+"|"+document.readyState+"|"+String(isSecureContext)',
  returnByValue: true
})

const script = `(async () => {
  const out = { origin: location.origin, secure: isSecureContext }
  try { out.uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch (e) { out.uvpaaErr = String(e) }
  try {
    const caps = await PublicKeyCredential.getClientCapabilities()
    out.passkeyPlatformAuthenticator = caps.passkeyPlatformAuthenticator
  } catch (e) {}
  const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)).buffer
  const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')
  let r
  try {
    r = await fetch('/api/register/options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Chrome' })
    })
  } catch (e) { return Object.assign(out, { fetchErr: String(e) }) }
  if (!r.ok) return Object.assign(out, { optionsStatus: r.status, optionsFail: await r.text() })
  const { cid, options } = await r.json()
  out.rpId = options.rp.id
  out.authSel = options.authenticatorSelection
  options.challenge = b64uToBuf(options.challenge)
  options.user.id = b64uToBuf(options.user.id)
  let cred
  try { cred = await navigator.credentials.create({ publicKey: options }) }
  catch (e) { return Object.assign(out, { createError: { name: e.name, message: e.message } }) }
  const body = {
    cid,
    credential: {
      id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults(),
      authenticatorAttachment: cred.authenticatorAttachment || null,
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON),
        attestationObject: bufToB64u(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : ['internal']
      }
    }
  }
  const v = await fetch('/api/register/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  out.verifyStatus = v.status
  out.verify = await v.json()
  const me = await fetch('/api/me')
  out.meStatus = me.status
  out.me = await me.json()

  await fetch('/api/logout', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
  const lo = await (await fetch('/api/login/options', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })).json()
  lo.options.challenge = b64uToBuf(lo.options.challenge)
  let assertion
  try { assertion = await navigator.credentials.get({ publicKey: lo.options }) }
  catch (e) { return Object.assign(out, { loginError: { name: e.name, message: e.message } }) }
  const loginBody = {
    cid: lo.cid,
    credential: {
      id: assertion.id, rawId: bufToB64u(assertion.rawId), type: assertion.type,
      clientExtensionResults: assertion.getClientExtensionResults(),
      response: {
        clientDataJSON: bufToB64u(assertion.response.clientDataJSON),
        authenticatorData: bufToB64u(assertion.response.authenticatorData),
        signature: bufToB64u(assertion.response.signature),
        userHandle: assertion.response.userHandle ? bufToB64u(assertion.response.userHandle) : null
      }
    }
  }
  const lv = await fetch('/api/login/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginBody)
  })
  out.loginStatus = lv.status
  out.login = await lv.json()
  const me2 = await fetch('/api/me')
  out.me2Status = me2.status
  out.me2 = await me2.json()
  return out
})()`

const evalRes = await cdp('Runtime.evaluate', {
  expression: script, awaitPromise: true, returnByValue: true
}, 90000)

const result = {
  page: page.url,
  authenticatorId: auth.authenticatorId,
  ready: ready.result?.value,
  flow: evalRes.result?.value ?? evalRes.exceptionDetails ?? evalRes,
  health: await (await fetch(ORIGIN + '/api/health')).json()
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
ws.close()
console.log('wrote', OUT)
