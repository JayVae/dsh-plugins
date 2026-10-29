// Refuse to pack when lib/ would ship personal session data.
//
// The bundle itself must stay small (it carries no data at all now — traces are
// served at runtime), but a stale generated chunk left in lib/ would still be
// published: npm packs by the "files" field, not by .gitignore. Anything large
// enough to be a session dump is treated as an accident.
import { readdirSync, statSync } from 'node:fs'

const libDir = new URL('../lib/', import.meta.url)
/** Excluded from the tarball by package.json "files", so never packed. */
const EXCLUDED = [/^assets$/, /\.bak\.js$/, /^client\.traces\.js$/]
const MAX_BYTES = 1024 * 1024

const offenders = []
for (const name of readdirSync(libDir)) {
  if (EXCLUDED.some((pattern) => pattern.test(name))) continue
  const { size } = statSync(new URL(name, libDir))
  if (size > MAX_BYTES) offenders.push({ name, size })
}

if (offenders.length > 0) {
  console.error('\nREFUSING TO PACK: these lib/ files are too large to be code,')
  console.error('which means personal session data is sitting in them:')
  for (const { name, size } of offenders) console.error(`  lib/${name}  ${(size / 1048576).toFixed(1)} MB`)
  console.error('\nDelete them (the viewer serves data at runtime now), then publish.\n')
  process.exit(1)
}

const { size } = statSync(new URL('client.js', libDir))
console.log(`prepack ok: lib/ carries no session data (client.js ${(size / 1024).toFixed(0)} KB)`)
