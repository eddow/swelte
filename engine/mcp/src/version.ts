import { createRequire } from 'node:module'

// Single truth: package.json version. No hardcoded VERSION constant.
const require = createRequire(import.meta.url)
export const VERSION: string = require('../package.json').version
