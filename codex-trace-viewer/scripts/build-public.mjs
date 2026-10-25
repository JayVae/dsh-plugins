// Build a publishable bundle: replaces the inlined personal session data
// with an empty set. Run `pnpm run build:public` before `npm publish`.
import { writeFileSync } from 'node:fs'

writeFileSync(new URL('../lib/assets/traces.json', import.meta.url), '[]')
console.log('lib/assets/traces.json reset to [] (public build)')
