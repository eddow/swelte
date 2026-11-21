// Vite owns process-level exit handlers. A worker keeps those handlers and
// environment changes local while the CLI owns shutdown and the V backend.
import { Worker } from 'node:worker_threads'

export interface DevVite {
	prepare(): Promise<void>
	restart(): Promise<void>
	close(): Promise<void>
}

export async function startDevVite(
	root: string,
	port: number,
	env: NodeJS.ProcessEnv
): Promise<DevVite> {
	const worker = new Worker(new URL('./dev-vite-worker.js', import.meta.url), {
		workerData: { root, port },
		// Single-writer rule: the plugin's configureServer watcher skips its
		// autonomous generate() under this flag so the controller queue's
		// prepare() is the only .swelte/ writer the native compiler can race.
		env: { ...env, SWELTE_DEV_CONTROLLER: '1' },
	})
	let nextId = 0
	let failure: Error | undefined
	const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
	const fail = (error: Error) => {
		failure = error
		for (const task of waiting.values()) task.reject(error)
		waiting.clear()
	}
	worker.on('error', fail)
	worker.on('exit', (code) => fail(new Error(`Vite worker exited (code ${code})`)))
	worker.on('message', (message: { id: number; error?: string }) => {
		const task = waiting.get(message.id)
		waiting.delete(message.id)
		if (message.error) task?.reject(new Error(message.error))
		else task?.resolve()
	})
	const call = (action: 'start' | 'prepare' | 'restart' | 'close') =>
		new Promise<void>((resolve, reject) => {
			if (failure) {
				reject(failure)
				return
			}
			const id = nextId++
			waiting.set(id, { resolve, reject })
			worker.postMessage({ id, action })
		})
	let closing: Promise<void> | undefined
	const close = () =>
		(closing ??= (async () => {
			try {
				if (!failure) await call('close')
			} finally {
				await worker.terminate()
			}
		})())
	try {
		await call('start')
		return { prepare: () => call('prepare'), restart: () => call('restart'), close }
	} catch (error) {
		await worker.terminate()
		throw error
	}
}
