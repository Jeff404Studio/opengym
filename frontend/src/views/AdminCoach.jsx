import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The operator's side of the Coach: is it on, can it reach a model, and what has it been
   doing. Like the rest of the admin dashboard this is deliberately English-only — it isn't
   part of the translated end-user surface.
 *
 * What it never shows: anybody's intake answers, payloads or proposals. An admin can enable
 * the feature and see that jobs ran; they cannot read what their users asked it. */

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export default function AdminCoach() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const refreshConfig = useStore(s => s.refreshConfig)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/coach').then(setD).catch(e => toast(e.message || 'Failed to load'))
  useEffect(() => { load() }, [])

  const patch = async body => {
    setBusy(true)
    try {
      await api('/api/admin/coach/config', { method: 'POST', body: JSON.stringify(body) })
      await load()
      await refreshConfig()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/test', { method: 'POST', body: '{}' })
      toast(r.ok
        ? 'Coach test passed — athletes open Coach from Home (sparkles) or Settings → Coach'
        : 'Test failed: ' + (r.error || 'unknown'))
      await load()
      await refreshConfig()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/admin/coach/auth/disconnect', { method: 'POST', body: '{}' }); toast('Disconnected'); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">Loading Coach status…</div></div>

  if (d.disabledByEnv) return <div className="card">
    <h2 style={{ margin: '0 0 6px' }}>AI Coach</h2>
    <div className="muted small">Force-disabled by <code>COACH_DISABLED</code> in the environment. Remove it to configure the Coach here.</div>
  </div>

  const meta = d.providers.find(p => p.id === d.provider) || {}
  const authed = d.auth?.state === 'connected' || d.auth?.state === 'not-required'
  const live = d.enabled && d.runtime.ok && authed

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>AI Coach</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>

    {!d.enabled && <div className="muted small">Off. Users see no Coach anywhere in the app.</div>}

    {d.enabled && <>
      <div className="tiles" style={{ textAlign: 'left', marginBottom: 10 }}>
        <div className="tile"><div className="l">Runtime</div>
          <div className="v" style={{ fontSize: '.9rem', color: d.runtime.ok ? 'var(--green)' : 'var(--red)' }}>{d.runtime.ok ? 'ready' : 'missing'}</div></div>
        <div className="tile"><div className="l">Credential</div>
          <div className="v" style={{ fontSize: '.9rem', color: authed ? 'var(--green)' : 'var(--red)' }}>{authLabel(d.auth)}</div></div>
        <div className="tile"><div className="l">Jobs today</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.jobsToday}</div></div>
        <div className="tile"><div className="l">Last run</div><div className="v" style={{ fontSize: '.85rem' }}>{rel(d.lastSuccess?.at)}</div></div>
      </div>

      {d.runtime.version && <div className="dim small" style={{ marginBottom: 8 }}>{meta.runtime || meta.label} · {d.runtime.version}</div>}
      {!d.runtime.ok && d.runtime.error && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>{d.runtime.error}</div>}

      {/* provider */}
      <h4 className="sec" style={{ marginTop: 4 }}>Provider</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
        {d.providers.map(p => <button key={p.id} className={'chip' + (p.id === d.provider ? ' on' : '')}
          disabled={busy} onClick={() => patch({ provider: p.id })}>{p.label}</button>)}
      </div>

      {/* credential */}
      {(meta.setupToken || meta.deviceLogin || meta.apiKey || meta.noCred) && <>
        <h4 className="sec">Credential</h4>
        {meta.noCred ? <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            No API key. The server reaches Ollama via <code>OLLAMA_BASE_URL</code>
            {d.auth?.state === 'not-required' ? ' (configured).' : ' — set it in the environment, then reload.'}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="check" disabled={busy || d.auth?.state !== 'not-required'} onClick={test}>Test the Coach</Button>
          </div>
        </> : d.auth?.state === 'connected' ? <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Connected{d.auth.account ? ' as ' + d.auth.account : ''} via {credentialLabel(d.auth.type)} · {rel(d.auth.connectedAt)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="check" disabled={busy} onClick={test}>Test the Coach</Button>
            <Button size="sm" danger disabled={busy} onClick={disconnect}>Disconnect</Button>
          </div>
        </> : <>
          {d.auth?.state === 'expired' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>The stored credential expired — connect again.</div>}
          {d.auth?.state === 'replace-required' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
            The old Claude credential is no longer used. Add a Claude Code setup token instead.
          </div>}
          {d.auth?.state === 'unreadable' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
            The stored credential can't be decrypted — this usually means ./data was restored without its <code>secret</code> file. Connect again.
          </div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {meta.setupToken && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} label={meta.label} />)}>Add CLI token</Button>}
            {meta.deviceLogin && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <ChatGPTLoginSheet close={close} onDone={load} label={meta.label} />)}>Sign in with ChatGPT</Button>}
            {meta.apiKey && !meta.setupToken && <Button size="sm" icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} />)}>Use an API key</Button>}
          </div>
        </>}
      </>}

      {/* limits */}
      <h4 className="sec">Limits</h4>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <label className="small muted">Per user / day
          <input className="num" type="number" min="0" max="200" defaultValue={d.caps.perProfileDaily} style={{ width: 70, marginLeft: 8 }}
            onBlur={e => patch({ caps: { ...d.caps, perProfileDaily: +e.target.value } })} /></label>
        <label className="small muted">Whole instance / day
          <input className="num" type="number" min="0" max="5000" defaultValue={d.caps.instanceDaily} style={{ width: 70, marginLeft: 8 }}
            onBlur={e => patch({ caps: { ...d.caps, instanceDaily: +e.target.value } })} /></label>
      </div>
      <div className="dim small" style={{ marginBottom: 10 }}>0 = no limit. Every job is one session on your provider account.</div>

      <h4 className="sec">Model</h4>
      <TextField defaultValue={d.model || ''} placeholder="(the provider default)"
        onBlur={e => e.target.value !== (d.model || '') && patch({ model: e.target.value })} />

      {d.lastError && <>
        <h4 className="sec">Last failure</h4>
        <div className="small" style={{ color: 'var(--red)' }}>{d.lastError.errorClass}{d.lastError.detail ? ' — ' + d.lastError.detail : ''}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{rel(d.lastError.at)}</div>
      </>}

      {!!d.recent?.length && <>
        <h4 className="sec">Recent jobs</h4>
        {d.recent.slice(0, 8).map((e, i) => <div key={i} className="row between" style={{ padding: '5px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small">{e.kind}{e.trigger === 'scheduled' ? ' · scheduled' : ''}</span>
          <span className="dim" style={{ fontSize: '.72rem' }}>
            <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : e.outcome === 'ready' ? 'var(--acc)' : undefined }}>{e.outcome}</span>
            {e.ms ? ' · ' + Math.round(e.ms / 1000) + 's' : ''} · {rel(e.at)}
          </span>
        </div>)}
      </>}
    </>}
  </div>
}

const authLabel = a => ({
  connected: 'connected', 'not-required': 'n/a', disconnected: 'needed', expired: 'expired', unreadable: 'unreadable', 'replace-required': 'replace'
}[a?.state] || '—')

const credentialLabel = type => ({
  'cli-token': 'Claude Code setup token', 'chatgpt-cli': 'ChatGPT CLI login', oauth: 'legacy token', apikey: 'API key'
}[type] || 'credential')

/* ------------------------------- setup token -------------------------------- */

function SetupTokenSheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/auth/setup-token', { method: 'POST', body: JSON.stringify({ token: token.trim() }) })
      setToken('')
      toast(r.test?.ok ? 'Connected ✅' : 'Saved, but the test failed: ' + (r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      On a trusted computer where you use Claude Code, run <code>claude setup-token</code>, complete its normal browser sign-in, then paste the token it prints here. This app never opens or handles Claude's authorization flow.
    </div>
    <TextField value={token} autoFocus type="password" placeholder="paste setup token" onChange={e => setToken(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !token.trim()} onClick={save}>Save and test</Button>
    <div style={{ height: 8 }} />
  </>
}

/* ----------------------------- ChatGPT device login ----------------------------- */

function ChatGPTLoginSheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [login, setLogin] = useState(null)
  const [busy, setBusy] = useState(false)

  const poll = async () => {
    try {
      const next = await api('/api/admin/coach/auth/chatgpt/status')
      setLogin(next)
      if (next.state === 'connected') {
        toast('ChatGPT connected ✅')
        close(); onDone()
      }
    } catch (e) { setLogin({ state: 'failed', error: e.message }) }
  }

  useEffect(() => {
    if (!['starting', 'pending'].includes(login?.state)) return undefined
    const timer = setInterval(poll, 1500)
    return () => clearInterval(timer)
  }, [login?.state])

  const start = async () => {
    setBusy(true)
    try {
      const next = await api('/api/admin/coach/auth/chatgpt/device', { method: 'POST', body: JSON.stringify({ replace: true }) })
      setLogin(next)
      if (next.state === 'connected') {
        toast('ChatGPT connected ✅')
        close(); onDone()
      }
    } catch (e) { toast(e.message); setLogin({ state: 'failed', error: e.message }) }
    setBusy(false)
  }

  const waiting = ['starting', 'pending'].includes(login?.state)
  return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      This starts Codex&apos;s official ChatGPT device-code sign-in inside the private Coach runtime. On your iPad or another trusted browser, open the link and enter the one-time code it shows. No API key is used or stored by Genefty.
    </div>
    {!waiting && login?.state !== 'connected' && <Button variant="primary" disabled={busy} onClick={start}>Start device sign-in</Button>}
    {waiting && <div className="small muted" style={{ marginBottom: 8 }}>Waiting for ChatGPT sign-in…</div>}
    {login?.instructions && <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 10, margin: '10px 0', border: '1px solid var(--sep)', borderRadius: 8, background: 'var(--bg)' }}>{login.instructions}</pre>}
    {login?.state === 'failed' && <div className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{login.error || 'ChatGPT sign-in did not complete. Start it again.'}</div>}
    <div className="dim small" style={{ marginTop: 12, lineHeight: 1.5 }}>
      Codex stores its refreshable CLI login cache in this server&apos;s private Coach volume. It is treated like a password and is never shown in this app.
    </div>
    <div style={{ height: 8 }} />
  </>
}

function ApiKeySheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/auth/key', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
      toast(r.test?.ok ? 'Key saved ✅' : 'Saved, but the test failed: ' + (r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{label} API key</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      Stored encrypted on this server and passed to the provider runtime only while a job runs. It is never shown again and never leaves the server.
    </div>
    <TextField value={key} autoFocus type="password" placeholder="sk-…" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>Save key</Button>
    <div style={{ height: 8 }} />
  </>
}
