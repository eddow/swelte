// `@swelte/qjs` — shared embedded-QuickJS engine (leaf package, zero runtime deps).
// Vendored C (`c/`), shared V module (`qjs.v` + `agent.v`), and the
// consumer-agnostic archive builder (`src/qjs.ts` → `dist/qjs.js`).
// SSR (`@swelte/ssr-qjs`) and PTC (`@swelte/ai` agent plugin) consume
// `buildQjsLib`; per-consumer bridge templates stay adapter-owned.
export type { QjsLibOut } from './qjs.js'
export {
	buildQjsLib,
	qjsCDir,
	qjsTargetPair,
	resolveHostNativeCC,
	resolveSystemCC,
	resolveTargetCc,
	whichCC,
} from './qjs.js'
export { VERSION } from './version.js'
