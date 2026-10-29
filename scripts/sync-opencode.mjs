#!/usr/bin/env node
// Keep the OpenCode package in lockstep with the Codex one.
//
// Both plugins are published independently, so each ships its own copy of the
// client source and of the host companion. This script derives the OpenCode
// copies from the Codex ones: one implementation, two packages, no drift.
//
// Run from anywhere:  node scripts/sync-opencode.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CODEX = 'codex-trace-viewer'
const OPENCODE = 'opencode-trace-viewer'

/** [anchor, replacement] — every anchor must exist or the run aborts. */
const CLIENT_REPLACEMENTS = [
  // package id drives both the module id and the route prefix
  ['dsh-client-codex-trace-viewer', 'dsh-client-opencode-trace-viewer'],
  ['CodexTraceApp', 'OpenCodeTraceApp'],
  ["'Loading Codex traces…'", "'Loading OpenCode traces…'"],
  ["'Select a Codex session'", "'Select an OpenCode session'"],
  ['<title>Codex Trace Viewer</title>', '<title>OpenCode Trace Viewer</title>'],
  ["'aria-label': 'Codex Traces'", "'aria-label': 'OpenCode Traces'"],
  ["title: 'Codex Traces'", "title: 'OpenCode Traces'"],
  ["!compact && h('span', null, 'Codex Traces')", "!compact && h('span', null, 'OpenCode Traces')"],
  ["h('div', { style: { fontSize: '40px' } }, '🧭')", "h('div', { style: { fontSize: '40px' } }, '🌀')"],
  ["}, '🧭', !compact &&", "}, '🌀', !compact &&"],
  ['codex-trace-viewer: style lifetime', 'opencode-trace-viewer: style lifetime'],
  ["id: 'codex-trace-viewer', order: 150", "id: 'opencode-trace-viewer', order: 151"],
  ["return { name: 'codex-trace-viewer', inject: ['slots'], apply }", "return { name: 'opencode-trace-viewer', inject: ['slots'], apply }"],
]

const HOST_REPLACEMENTS = [
  ['/.dsh-codex-trace-viewer', '/.dsh-opencode-trace-viewer'],
  ['dsh-client-codex-trace-viewer', 'dsh-client-opencode-trace-viewer'],
]

function mirror(relPath, replacements) {
  const src = join(root, CODEX, relPath)
  const dst = join(root, OPENCODE, relPath)
  let text = readFileSync(src, 'utf8')
  const missing = []
  for (const [from, to] of replacements) {
    if (!text.includes(from)) { missing.push(from); continue }
    text = text.split(from).join(to)
  }
  if (missing.length) {
    console.error(`missing anchors in ${CODEX}/${relPath} (nothing written):`)
    for (const anchor of missing) console.error('  ' + anchor)
    process.exit(1)
  }
  const leftover = ['dsh-client-codex-trace-viewer', 'CodexTraceApp'].filter((needle) => text.includes(needle))
  if (leftover.length) {
    console.error(`codex-only identifiers survived in ${OPENCODE}/${relPath}: ${leftover.join(', ')}`)
    process.exit(1)
  }
  writeFileSync(dst, text)
  console.log(`synced ${CODEX}/${relPath} -> ${OPENCODE}/${relPath} (${text.split('\n').length} lines)`)
}

mirror(join('src', 'client-main.js'), CLIENT_REPLACEMENTS)
mirror(join('lib', 'index.js'), HOST_REPLACEMENTS)
console.log('done — rebuild both packages with `npm run build` in each')
