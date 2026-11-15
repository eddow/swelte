const config = {}
Object.defineProperty(config, 'swelte', { value: { compat: 'sveltekit', isr: { '/isr': 1 }, serviceWorker: { enabled: true, register: 'manual', outbox: { paths: ['/outbox'], maxAttempts: 3 } }, prerender: { entries: 'all', concurrency: 3 } } })
export default config
