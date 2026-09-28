/* Tiny structured logger for Ferrum API (JSON lines → Railway). */

function base(level, msg, extra) {
  const row = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: 'ferrum-api',
    ...(extra && typeof extra === 'object' ? extra : {})
  }
  const line = JSON.stringify(row)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (msg, extra) => base('info', msg, extra),
  warn: (msg, extra) => base('warn', msg, extra),
  error: (msg, extra) => base('error', msg, extra),
}

export default log
