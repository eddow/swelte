import {
	createAgentPlugin,
	createToolsPlugin,
	emitToolBindings,
	emitToolManifest,
	schemaHash,
	selectTools,
	toolDocComments,
	toolManifestFor,
	validateAgainstSchema,
	validateToolFn,
} from './build.js'

/** Plugin registration (vite config): `swelte({ plugins: [toolsPlugin] })`,
 *  plus `agentPlugin` for programmatic (agent-JS) calls. Node-only. */
export { createAgentPlugin, createToolsPlugin }
export const toolsPlugin = createToolsPlugin()
export const agentPlugin = createAgentPlugin()

/** Build-time helpers for routes/tests that validate manifests and emit
 *  bindings at generate time (node-only; browser code never imports them).
 *  The V-side dispatcher lives in `./build.js` (module-private). */
export {
	emitToolBindings,
	emitToolManifest,
	schemaHash,
	selectTools,
	toolDocComments,
	toolManifestFor,
	validateAgainstSchema,
	validateToolFn,
}
