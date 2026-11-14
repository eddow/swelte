const config = {}
Object.defineProperty(config, 'swelte', { value: { compat: 'sveltekit', prerender: { entries: 'all', concurrency: 3 } } })
export default config
