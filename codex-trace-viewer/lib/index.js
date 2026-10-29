/** Host companion: serves the converted trace data and refreshes it on demand.
 *
 * Routes (all under {@link ROUTE_PREFIX}):
 *   GET  /index     directories + counts                       (a few KB)
 *   GET  /sessions  ?dir=<dirKey>  sessions of one directory   (a few KB)
 *   GET  /session   ?dir=<dirKey>&file=<file>  one session's events
 *   POST /refresh   re-runs scripts/convert.mjs, then reports what changed
 *
 * Data is sharded on disk (index.json + dirs/ + sessions/) and read per
 * request, so the viewer downloads a directory before a session and never the
 * whole history: the old single traces.json reached 12 MB and grew with every
 * conversation. Because every file is read per request, the "更新数据" button
 * only has to POST /refresh and re-fetch /index — no rebuild or restart.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route prefix registered on the DSH web server. */
export const ROUTE_PREFIX = '/.dsh-codex-trace-viewer'
/** `GET` — directory index (re-read from disk per request). */
export const ROUTE_INDEX = `${ROUTE_PREFIX}/index`
/** `GET` — sessions of one directory (`?dir=<dirKey>`). */
export const ROUTE_SESSIONS = `${ROUTE_PREFIX}/sessions`
/** `GET` — one session's events (`?dir=<dirKey>&file=<file>`). */
export const ROUTE_SESSION = `${ROUTE_PREFIX}/session`
/** `POST` — run the converter against this machine's sessions. */
export const ROUTE_REFRESH = `${ROUTE_PREFIX}/refresh`
/** Retired: the single monolithic JSON. Kept only to answer with an upgrade hint. */
export const ROUTE_TRACES = `${ROUTE_PREFIX}/traces`

const pkgDir = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]lib$/, '')
const dataDir = join(pkgDir, 'lib', 'assets')
const indexFile = join(dataDir, 'index.json')
const dirsDir = join(dataDir, 'dirs')
const sessionsDir = join(dataDir, 'sessions')
const convertScript = join(pkgDir, 'scripts', 'convert.mjs')

/** Shard names are generated hex digests, so anything else is a bad request. */
const KEY_RE = /^[0-9a-f]{12}$/
const FILE_RE = /^[0-9a-f]{12}\.json$/

/** A conversion longer than this is treated as hung and killed. */
const REFRESH_TIMEOUT_MS = 180_000

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Send a file's bytes verbatim: the client parses, the host never re-encodes. */
function sendFile(req, res, path) {
  if (!existsSync(path)) return false
  const body = readFileSync(path)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

/** One conversion at a time: a second click joins the run already in flight. */
let inFlight = null

function runConvert() {
  if (inFlight !== null) return inFlight
  const started = Date.now()
  inFlight = new Promise((resolve) => {
    if (!existsSync(convertScript)) {
      resolve({ ok: false, error: `converter missing at ${convertScript} — reinstall the package (its scripts/ folder is required)` })
      return
    }
    const child = spawn(process.execPath, [convertScript, '--out', dataDir], {
      cwd: pkgDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, durationMs: Date.now() - started })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish({ ok: false, error: `converter timed out after ${REFRESH_TIMEOUT_MS / 1000}s` })
    }, REFRESH_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ ok: false, error: String(error && error.message ? error.message : error) }))
    child.on('close', (code) => finish({
      ok: code === 0,
      code,
      stdout: stdout.trim(),
      stderr: stderr.trim().split('\n').filter((line) => !/ExperimentalWarning|trace-warnings/.test(line)).join('\n').trim(),
    }))
  })
  const clear = () => { inFlight = null }
  inFlight.then(clear, clear)
  return inFlight
}

/** Summarize the data set so the client can show what a refresh produced. */
function describeData() {
  if (!existsSync(indexFile)) return { dirs: 0, sessions: 0, events: 0, bytes: 0, mtimeMs: 0 }
  const stat = statSync(indexFile)
  try {
    const index = JSON.parse(readFileSync(indexFile, 'utf8'))
    const totals = index.totals || {}
    return {
      dirs: totals.dirs ?? (index.dirs || []).length,
      sessions: totals.sessions ?? 0,
      events: totals.events ?? 0,
      bytes: totals.bytes ?? 0,
      generatedAt: index.generatedAt || '',
      mtimeMs: stat.mtimeMs,
    }
  } catch {
    return { dirs: 0, sessions: 0, events: 0, bytes: 0, mtimeMs: stat.mtimeMs }
  }
}

export function apply(ctx) {
  // The webServer service may start after this plugin applies; defer route
  // registration until it is available (same pattern dsh-session-delete uses).
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    if (webServer === undefined) {
      console.error('dsh-client-codex-trace-viewer: no webServer service; traces route unavailable')
      return undefined
    }
    return webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const readOnly = req.method === 'GET' || req.method === 'HEAD'

        if (url.pathname === ROUTE_INDEX) {
          if (!readOnly) return json(res, 405, { error: 'method not allowed' })
          if (sendFile(req, res, indexFile)) return
          return json(res, 404, { error: 'no trace data converted yet — click 「⟳ 更新数据」 in the viewer, or run scripts/convert.mjs' })
        }

        if (url.pathname === ROUTE_SESSIONS) {
          if (!readOnly) return json(res, 405, { error: 'method not allowed' })
          const key = url.searchParams.get('dir') || ''
          if (!KEY_RE.test(key)) return json(res, 400, { error: 'bad dir key' })
          if (sendFile(req, res, join(dirsDir, `${key}.json`))) return
          return json(res, 404, { error: `no directory ${key} in the converted data — refresh` })
        }

        if (url.pathname === ROUTE_SESSION) {
          if (!readOnly) return json(res, 405, { error: 'method not allowed' })
          const key = url.searchParams.get('dir') || ''
          const file = url.searchParams.get('file') || ''
          // Both names are validated against generated hex digests, so a
          // crafted value can never walk out of lib/assets/sessions.
          if (!KEY_RE.test(key) || !FILE_RE.test(file)) return json(res, 400, { error: 'bad dir/file' })
          if (sendFile(req, res, join(sessionsDir, key, file))) return
          return json(res, 404, { error: `no session file ${key}/${file} — refresh` })
        }

        if (url.pathname === ROUTE_TRACES) {
          return json(res, 410, {
            error: 'this version serves /index, /sessions and /session — reload the viewer page to pick up the new client',
          })
        }

        if (url.pathname === ROUTE_REFRESH) {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          // A custom header cannot be attached cross-origin without a CORS
          // preflight this host never grants, so requiring it blocks CSRF from
          // any other page while staying trivial for the viewer.
          if (req.headers['x-dsh-trace-refresh'] !== '1') {
            return json(res, 403, { error: 'missing x-dsh-trace-refresh header' })
          }
          const result = await runConvert()
          return json(res, result.ok ? 200 : 500, { ...result, data: describeData() })
        }

        return json(res, 404, { error: 'not found' })
      },
    })
  })
}
