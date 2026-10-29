/** Host companion: serves the converted traces JSON to the browser viewer.
 *
 * The browser half (lib/client.js) fetches `/.dsh-opencode-trace-viewer/traces`
 * when the viewer opens. The JSON is re-read from disk on every request, so
 * re-running scripts/convert.mjs refreshes the viewer without rebuilding,
 * redeploying, or restarting the harness.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route prefix registered on the DSH web server. */
export const ROUTE_PREFIX = '/.dsh-opencode-trace-viewer'
/** `GET` — the converted traces JSON (re-read from disk per request). */
export const ROUTE_TRACES = `${ROUTE_PREFIX}/traces`

const dataFile = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'traces.json')

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
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
        if (url.pathname !== ROUTE_TRACES || (req.method !== 'GET' && req.method !== 'HEAD')) {
          return json(res, 404, { error: 'not found' })
        }
        if (!existsSync(dataFile)) {
          return json(res, 404, { error: `no traces converted yet — expected ${dataFile}; run scripts/convert.mjs (see README)` })
        }
        const body = readFileSync(dataFile)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    })
  })
}
