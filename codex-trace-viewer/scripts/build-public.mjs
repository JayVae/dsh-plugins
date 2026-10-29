// Public build: make sure no converted session data can reach the tarball.
// npm never packs lib/assets (package.json "files" excludes it), so this is
// belt-and-braces for anyone inspecting a local `npm pack`.
import { rmSync } from 'node:fs'

rmSync(new URL('../lib/assets', import.meta.url), { recursive: true, force: true })
console.log('lib/assets removed (public build)')
