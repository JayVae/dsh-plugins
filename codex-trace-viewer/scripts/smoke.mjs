#!/usr/bin/env node
// Smoke test for the viewer's 「⟳ 更新数据」 button.
//
// Drives the real built bundle with a tiny hooks shim: apply() registers the
// sidebar slot, the slot renders the viewer button, clicking it opens the popup,
// and the popup's root.render() hands back the App component. Then the test
// clicks the refresh button and asserts the HTTP traffic — no browser needed.
//
// Run: node scripts/smoke.mjs   (after node scripts/build.mjs)
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const bundlePath = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(bundlePath, 'utf8')
const route = '/.dsh-' + source.match(/const PKG_ID = '([^']+)'/)[1].replace('dsh-client-', '')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const text = (node) => JSON.stringify(node)

/** Invoke function components the way a renderer would, to reach real buttons. */
function expand(node) {
  if (Array.isArray(node)) return node.flat(Infinity).map(expand).filter((c) => c != null && c !== false)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props))
  return { ...node, children: (node.children || []).map(expand).filter((c) => c != null && c !== false) }
}

function findButtons(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'button') out.push(node)
  for (const child of node.children || []) findButtons(child, out)
  return out
}

// ---- harness ---------------------------------------------------------------
const calls = []
const responses = []
const React = {
  createElement: (type, props, ...children) => ({
    type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false),
  }),
  useState: () => [undefined, () => {}],
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
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

// ---- hooks shim bound to the component ------------------------------------
let store = []
let cursor = 0
let effects = []
React.useState = (init) => {
  const index = cursor++
  if (!(index in store)) store[index] = typeof init === 'function' ? init() : init
  const set = (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value }
  return [store[index], set]
}
React.useEffect = (fn) => { effects.push(fn) }
const render = () => { cursor = 0; effects = []; return expand(App()) }

// ---- 1. initial render, then let the load effect settle -------------------
responses.push([])
if (!text(render()).includes('Loading')) throw new Error('first render should show the loading state')
for (const fn of effects.slice()) fn()
await wait(20)

// ---- 2. click 「⟳ 更新数据」 ---------------------------------------------
// The click POSTs /refresh first, then re-fetches /traces: queue in that order.
responses.push({ ok: true, data: { traces: 0 } })
responses.push([])
const tree = render()
const button = findButtons(tree).find((b) => b.children.some((c) => typeof c === 'string' && c.includes('更新数据')))
if (!button) throw new Error('refresh button not found in the rendered sidebar')

const postsBefore = calls.filter((c) => c.method === 'POST').length
button.props.onClick()
const post = calls.filter((c) => c.method === 'POST')[postsBefore]
if (!post) throw new Error('click did not POST')
if (!post.url.endsWith(`${route}/refresh`)) throw new Error(`wrong refresh URL: ${post.url}`)
if (post.headers['x-dsh-trace-refresh'] !== '1') throw new Error('missing x-dsh-trace-refresh header (CSRF guard)')

await wait(30)
const after = text(render())
if (!after.includes('已更新')) throw new Error(`success message missing: ${after.slice(0, 200)}`)
const gets = calls.filter((c) => c.method === 'GET' && c.url.endsWith('/traces')).length
if (gets < 2) throw new Error(`did not re-fetch /traces after refresh (GETs=${gets})`)

console.log(`smoke ok: ${route} — click POSTs ${route}/refresh, then re-fetches ${route}/traces`)
