/** Host companion: serves the converted traces JSON and refreshes it on demand.
 *
 * Routes (all under {@link ROUTE_PREFIX}):
 *   GET  /traces   the converted JSON, re-read from disk on every request
 *   POST /refresh  re-runs scripts/convert.mjs, then reports what changed
 *
 * Because the JSON is read per request, the viewer's "更新数据" button only has
 * to POST /refresh and re-fetch /traces — no rebuild, redeploy, or restart.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route prefix registered on the DSH web server. */
export const ROUTE_PREFIX = '/.dsh-opencode-trace-viewer'
/** `GET` — the converted traces JSON (re-read from disk per request). */
export const ROUTE_TRACES = `${ROUTE_PREFIX}/traces`
/** `POST` — run the converter against this machine's sessions. */
export const ROUTE_REFRESH = `${ROUTE_PREFIX}/refresh`

const pkgDir = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]lib$/, '')
const dataDir = join(pkgDir, 'lib', 'assets')
const dataFile = join(dataDir, 'traces.json')
const convertScript = join(pkgDir, 'scripts', 'convert.mjs')

/** A conversion longer than this is treated as hung and killed. */
const REFRESH_TIMEOUT_MS = 180_000

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
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

/** Summarize the data file so the client can show what a refresh produced. */
function describeData() {
  if (!existsSync(dataFile)) return { traces: 0, bytes: 0, mtimeMs: 0 }
  const stat = statSync(dataFile)
  let traces = 0
  try { traces = JSON.parse(readFileSync(dataFile, 'utf8')).length } catch { /* report 0 rather than fail the refresh */ }
  return { traces, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

export function apply(ctx) {
  // The webServer service may start after this plugin applies; defer route
  // registration until it is available (same pattern dsh-session-delete uses).
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    if (webServer === undefined) {
      console.error('dsh-client-opencode-trace-viewer: no webServer service; traces route unavailable')
      return undefined
    }
    return webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (url.pathname === ROUTE_TRACES) {
          if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
          if (!existsSync(dataFile)) {
            return json(res, 404, { error: 'no traces converted yet — click 「⟳ 更新数据」 in the viewer, or run scripts/convert.mjs' })
          }
          const body = readFileSync(dataFile)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(req.method === 'HEAD' ? undefined : body)
          return
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
