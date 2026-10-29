#!/usr/bin/env node
// Smoke test for the viewer's three-level load path and its 「⟳ 更新数据」 button.
//
// Drives the real built bundle with a tiny hooks shim: apply() registers the
// sidebar slot, the slot renders the viewer button, clicking it opens the popup,
// and the popup's root.render() hands back the App component. The test then
// walks the same path a user walks — index → directory → session → refresh —
// and asserts the HTTP traffic, so no browser is needed.
//
// Run: node scripts/smoke.mjs   (after node scripts/build.mjs)
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const bundlePath = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(bundlePath, 'utf8')
const route = '/.dsh-' + source.match(/const PKG_ID = '([^']+)'/)[1].replace('dsh-client-', '')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const text = (node) => JSON.stringify(node)

// ---- harness ---------------------------------------------------------------
// One state frame per component instance (keyed by position in the tree), the
// way React keeps hooks apart; a single shared store would make the trace view
// overwrite the app's own state.
const calls = []
const responses = []
const frames = new Map()
const pendingEffects = []
let frameSeq = 0
let currentFrame = null

const React = {
  createElement: (type, props, ...children) => ({
    type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false),
  }),
  useState: (init) => {
    const frame = currentFrame
    const index = frame.cursor++
    if (!(index in frame.store)) frame.store[index] = typeof init === 'function' ? init() : init
    return [frame.store[index], (value) => {
      frame.store[index] = typeof value === 'function' ? value(frame.store[index]) : value
    }]
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useEffect: (fn) => { pendingEffects.push(fn) },
}

/** Invoke function components the way a renderer would, to reach real buttons. */
function expand(node) {
  if (Array.isArray(node)) return node.flat(Infinity).map(expand).filter((c) => c != null && c !== false)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const key = (node.type.name || 'anonymous') + '#' + frameSeq++
    let frame = frames.get(key)
    if (!frame) { frame = { store: [], cursor: 0 }; frames.set(key, frame) }
    frame.cursor = 0
    const previous = currentFrame
    currentFrame = frame
    let out
    try { out = node.type(node.props) } finally { currentFrame = previous }
    return expand(out)
  }
  return { ...node, children: (node.children || []).map(expand).filter((c) => c != null && c !== false) }
}

function findClickable(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.props && typeof node.props.onClick === 'function') out.push(node)
  for (const child of node.children || []) findClickable(child, out)
  return out
}

let registration = null
let captured = null
const popupDocument = { write() {}, close() {}, getElementById: () => ({}) }
const sandbox = {
  window: {
    __ModuleLoader__: { load: (value) => { registration = value } },
    location: { origin: 'http://127.0.0.1:3080' },
    opener: null,
    innerWidth: 1400,
    open: () => ({ document: popupDocument }),
  },
  document: {
    createElement: () => ({ dataset: {}, textContent: '', style: {} }),
    head: { appendChild() {} },
    body: { style: {} },
  },
  fetch: (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', headers: (init && init.headers) || {} })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responses.shift()) })
  },
  URL, Promise, console, setTimeout, clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
}
sandbox.globalThis = sandbox
runInContext(source, createContext(sandbox))

const mod = registration.factory((spec) => {
  if (spec === 'react') return React
  if (spec === 'react-dom/client') return { createRoot: () => ({ render: (element) => { captured = element } }) }
  throw new Error(`unexpected require: ${spec}`)
})

let slotRender = null
mod.apply({
  effect: () => {},
  slots: {
    inject: (_name, callback) => callback(),
    register: (_options, component) => { slotRender = component },
  },
})
if (slotRender === null) throw new Error('sidebar slot was not registered')

const viewerButton = slotRender({ wide: true })
if (!viewerButton || !viewerButton.props.onClick) throw new Error('viewer button has no onClick')
viewerButton.props.onClick()
if (!captured || typeof captured.type !== 'function') throw new Error('App component was not captured')
const App = captured.type

const render = () => { frameSeq = 0; pendingEffects.length = 0; return expand({ type: App, props: {}, children: [] }) }
/** Run the effects a render queued (the app only loads on mount). */
const settle = async () => {
  for (const fn of pendingEffects.slice()) fn()
  await wait(20)
}
const gets = (suffix) => calls.filter((c) => c.method === 'GET' && c.url.endsWith(suffix)).length
const clickOn = (tree, needle) => {
  const node = findClickable(tree).find((n) => text(n).includes(needle))
  if (!node) throw new Error(`nothing clickable containing ${JSON.stringify(needle)}`)
  node.props.onClick()
}

// ---- fixtures --------------------------------------------------------------
const DIR_KEY = 'aaaaaaaaaaaa'
const SESSION_FILE = 'cccccccccccc.json'
const indexPayload = {
  version: 2,
  generatedAt: '2026-02-14 10:00:00',
  totals: { dirs: 2, sessions: 2, events: 4, bytes: 4096 },
  dirs: [
    { key: DIR_KEY, path: '/proj/one', folder: 'proj-one', sessions: 1, events: 2, bytes: 2048, latest: '2026-02-14 09:00:00' },
    { key: 'bbbbbbbbbbbb', path: '/proj/two', folder: 'proj-two', sessions: 1, events: 2, bytes: 2048, latest: '2026-02-13 09:00:00' },
  ],
}
// The Codex converter emits `name`, the OpenCode one `title`; a hand-written
// shard may carry either, so both shapes must render a label.
const dirPayload = {
  key: DIR_KEY,
  path: '/proj/one',
  folder: 'proj-one',
  sessions: [
    { id: 's1', title: 'opencode-style title', date: '2026-02-14', events: 2, bytes: 100, file: SESSION_FILE },
    { id: 's2', name: 'codex-style name', date: '2026-02-13', events: 2, bytes: 100, file: 'dddddddddddd.json' },
  ],
}
const sessionPayload = {
  id: 's1',
  name: 'opencode-style title',
  directory: '/proj/one',
  date: '2026-02-14',
  events: [
    { kind: 'user', label: 'user', time: '2026-02-14 09:00:00', text: 'hello from smoke' },
    { kind: 'assistant', label: 'assistant', time: '2026-02-14 09:00:05', text: 'reply from smoke' },
  ],
}

// ---- 1. opening the viewer loads only the directory index ------------------
responses.push(indexPayload)
if (!text(render()).includes('Loading')) throw new Error('first render should show the loading state')
await settle()

if (gets(`${route}/index`) !== 1) throw new Error('the viewer did not fetch the directory index')
if (calls.some((c) => c.url.includes('/session'))) throw new Error('opening the viewer fetched session data — it must stay lazy')
const firstScreen = text(render())
if (!firstScreen.includes('proj-one') || !firstScreen.includes('proj-two')) throw new Error('directories did not render')
if (firstScreen.includes('opencode-style title')) throw new Error('sessions were rendered before a directory was picked')

// ---- 2. picking a directory loads exactly that directory -------------------
responses.push(dirPayload)
clickOn(render(), 'proj-one')
await wait(20)
if (gets(`${route}/sessions?dir=${DIR_KEY}`) !== 1) throw new Error('clicking a directory did not fetch its sessions')
const dirScreen = text(render())
if (!dirScreen.includes('opencode-style title')) throw new Error('session with only `title` renders no name')
if (!dirScreen.includes('codex-style name')) throw new Error('session with `name` renders no name')
if (dirScreen.includes('hello from smoke')) throw new Error('picking a directory fetched session events — it must stay lazy')

// ---- 3. opening a session loads its events --------------------------------
responses.push(sessionPayload)
clickOn(render(), 'opencode-style title')
await wait(20)
if (gets(`${route}/session?dir=${DIR_KEY}&file=${SESSION_FILE}`) !== 1) throw new Error('clicking a session did not fetch its events')
if (!text(render()).includes('hello from smoke')) throw new Error('session events did not render')

// ---- 4. 「⟳ 更新数据」 re-runs the converter, then reloads ------------------
// POST /refresh, then GET /index, then (the open directory is kept) GET /sessions.
responses.push({ ok: true, data: { dirs: 2, sessions: 2, events: 4, bytes: 4096 } })
responses.push(indexPayload)
responses.push(dirPayload)
const postsBefore = calls.filter((c) => c.method === 'POST').length
const indexGetsBefore = gets(`${route}/index`)
clickOn(render(), '更新数据')
const post = calls.filter((c) => c.method === 'POST')[postsBefore]
if (!post) throw new Error('click did not POST')
if (!post.url.endsWith(`${route}/refresh`)) throw new Error(`wrong refresh URL: ${post.url}`)
if (post.headers['x-dsh-trace-refresh'] !== '1') throw new Error('missing x-dsh-trace-refresh header (CSRF guard)')
await wait(40)
if (!text(render()).includes('已更新')) throw new Error('success message missing')
if (gets(`${route}/index`) <= indexGetsBefore) throw new Error('did not re-fetch the index after refresh')

console.log(`smoke ok: ${route} — index → directory → session → refresh, all lazy`)
