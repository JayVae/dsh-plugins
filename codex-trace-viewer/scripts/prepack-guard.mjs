// Refuse to pack when lib/ still contains personal session data.
import { statSync } from 'node:fs'

const size = statSync(new URL('../lib/client.js', import.meta.url)).size
if (size > 500 * 1024) {
  console.error(`\nREFUSING TO PACK: lib/client.js is ${(size / 1048576).toFixed(1)} MB,`)
  console.error('which means personal session data is still inlined.')
  console.error('Run `npm run build:public` first, then publish.\n')
  process.exit(1)
}
console.log('prepack ok: bundle looks clean (' + (size / 1024).toFixed(0) + ' KB)')
