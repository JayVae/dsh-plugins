#!/usr/bin/env node
// Rebuild lib/client.js: inlines lib/assets/traces.json into src/client-main.js.
// NOTE: the replacement MUST be a function — String.replace would otherwise
// interpret $&/$' sequences inside the JSON payload.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const traces = readFileSync(join(pkgDir, 'lib', 'assets', 'traces.json'), 'utf8')
const template = readFileSync(join(pkgDir, 'src', 'client-main.js'), 'utf8')
const out = template
  .replace('/*__TRACES_DATA__*/[]', () => traces)
  .replaceAll('dsh-client-codex-trace-viewer', 'dsh-client-opencode-trace-viewer')
if (!out.includes('TRACES_DATA = [')) throw new Error('placeholder missing')
if (out.includes('dsh-client-codex-trace-viewer')) throw new Error('plugin id not rewritten')
writeFileSync(join(pkgDir, 'lib', 'client.js'), out)
console.log(`built lib/client.js (${(out.length / 1e6).toFixed(1)} MB)`)
