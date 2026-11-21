import { parentPort, workerData } from 'node:worker_threads'
import { createServer, type ViteDevServer } from 'vite'

const channel = parentPort!
let server: ViteDevServer | undefined
let pending = Promise.resolve()
channel.on('message', ({ id, action }: { id: number; action: string }) => {
	pending = pending.then(async () => {
		try {
			if (action === 'start') {
				server = await createServer({
					root: workerData.root,
					server: { port: workerData.port, strictPort: true },
				})
				await server.listen()
			} else if (action === 'prepare') {
				const plugin = server?.config.plugins.find((item) => item.name === 'swelte')
				if (typeof plugin?.api?.generate !== 'function')
					throw new Error('swelte() plugin is required to generate the backend')
				await plugin.api.generate()
			} else if (action === 'restart') {
				await server?.restart()
			} else if (action === 'close') {
				await server?.close()
			}
			channel.postMessage({ id })
		} catch (error) {
			channel.postMessage({ id, error: (error as Error).stack ?? String(error) })
		}
	})
})
