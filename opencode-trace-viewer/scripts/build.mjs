#!/usr/bin/env node
// Build the plugin bundle:
//   lib/client.js  UI entry, loaded at page startup. It carries NO trace data —
//                  traces are fetched at runtime from the host companion route
//                  (/.dsh-opencode-trace-viewer/traces), which re-reads
//                  lib/assets/traces.json on every request. Regenerate the data
//                  with scripts/convert.mjs; a rebuild is only needed when
//                  src/client-main.js changes.
// NOTE: the id rewrite MUST be a function — String.replace would otherwise
// interpret $&/$' sequences inside the payload.
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

const out = neutralizeMarkers(template.replaceAll('dsh-client-codex-trace-viewer', () => 'dsh-client-opencode-trace-viewer'))
if (out.includes('dsh-client-codex-trace-viewer')) throw new Error('plugin id not rewritten')
writeFileSync(join(pkgDir, 'lib', 'client.js'), out)
console.log(`built lib/client.js (${(out.length / 1e3).toFixed(0)} kB; data served at runtime by lib/index.js)`)
