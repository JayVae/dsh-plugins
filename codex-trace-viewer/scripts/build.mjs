#!/usr/bin/env node
// Rebuild lib/client.js: inlines lib/assets/traces.json into src/client-main.js.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const traces = readFileSync(join(pkgDir, 'lib', 'assets', 'traces.json'), 'utf8')
const template = readFileSync(join(pkgDir, 'src', 'client-main.js'), 'utf8')
const out = template.replace('/*__TRACES_DATA__*/[]', () => traces)
if (!out.includes('TRACES_DATA = [')) throw new Error('placeholder missing')
writeFileSync(join(pkgDir, 'lib', 'client.js'), out)
console.log(`built lib/client.js (${(out.length / 1e6).toFixed(1)} MB)`)
