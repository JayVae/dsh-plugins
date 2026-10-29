#!/usr/bin/env node
// Build the plugin bundle:
//   lib/client.js  UI entry, loaded at page startup. It carries NO trace data —
//                  data is fetched at runtime from the host companion routes
//                  (/.dsh-codex-trace-viewer/{index,sessions,session}), which
//                  re-read lib/assets/{index.json,dirs/,sessions/} per request.
//                  Regenerate the data with scripts/convert.mjs; a rebuild is
//                  only needed when src/client-main.js changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const template = readFileSync(join(pkgDir, 'src', 'client-main.js'), 'utf8')

// The DSH host strips bundle trailers with /\/\/# (sourceMappingURL|sourceURL)=[^\r\n]*$/,
// which matches the FIRST occurrence of those markers when everything after it sits on one
// line — it once truncated a 12 MB single-line bundle at a marker embedded in trace data.
// Trace data is no longer bundled, but keep the neutralization so an embedded marker can
// never resurrect that failure: "\u0023" decodes to "#" at runtime, keeping the visible
// text byte-identical while breaking the host's regex sequence.
const neutralizeMarkers = (source) =>
  source.replace(/\/\/# (?=sourceMappingURL=|sourceURL=)/g, '//\\u0023 ')

writeFileSync(join(pkgDir, 'lib', 'client.js'), neutralizeMarkers(template))
console.log(`built lib/client.js (${(template.length / 1e3).toFixed(0)} kB; data served at runtime by lib/index.js)`)
