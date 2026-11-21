import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type Socket } from 'node:net'

interface Exit {
	code: number | null
	signal: NodeJS.Signals | null
}
function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	// Readiness may fail while the controller is still stopping an earlier generation.
	void promise.catch(() => {})
	return { promise, resolve, reject }
}

export interface DevApplication {
	child: ChildProcess
	ready: Promise<void>
	exited: Promise<Exit>
	stop(reason: string): Promise<void>
}

/** A private, per-launch channel. Logs and application HTTP are never commands. */
export async function launchDevApplication(
	command: { file: string; args?: string[] },
	options: SpawnOptions,
	settings: {
		generation: number
		shutdownMs: number
		startupMs?: number
		log: (message: string) => void
	}
): Promise<DevApplication> {
	const token = randomBytes(32).toString('hex')
	const ready = deferred<void>()
	const exited = deferred<Exit>()
	let child: ChildProcess
	let peer: Socket | undefined
	let stopping: Promise<void> | undefined
	let stopReason: string | undefined
	let startupTimer: NodeJS.Timeout | undefined
	let ended = false
	const sockets = new Set<Socket>()
	const listener = createServer((socket) => {
		sockets.add(socket)
		socket.setTimeout(5000, () => socket.destroy())
		socket.on('error', () => socket.destroy())
		let buffer = ''
		let authenticated = false
		socket.on('data', (chunk) => {
			buffer += chunk.toString()
			if (buffer.length > 4096) {
				socket.destroy()
				return
			}
			let newline: number
			while ((newline = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, newline)
				buffer = buffer.slice(newline + 1)
				let message: {
					type?: string
					token?: string
					generation?: number
					version?: number
					pid?: number
				}
				try {
					message = JSON.parse(line)
				} catch {
					socket.destroy()
					return
				}
				if (!message || typeof message !== 'object') {
					socket.destroy()
					return
				}
				if (!authenticated) {
					if (
						peer ||
						message.type !== 'hello' ||
						message.version !== 1 ||
						message.token !== token ||
						message.generation !== settings.generation ||
						message.pid !== child.pid
					) {
						socket.destroy()
						return
					}
					authenticated = true
					peer = socket
					socket.setTimeout(0)
					socket.write('{"type":"accepted"}\n')
					if (stopReason) socket.write(`${JSON.stringify({ type: 'stop', reason: stopReason })}\n`)
				} else if (message.type === 'ready' && !stopReason) {
					clearTimeout(startupTimer)
					ready.resolve()
				} else if (
					message.type !== 'ready' &&
					message.type !== 'stopping' &&
					message.type !== 'stopped'
				) {
					socket.destroy()
					return
				}
			}
		})
		socket.on('close', () => {
			sockets.delete(socket)
			if (peer === socket && !ended) {
				ready.reject(new Error('backend control connection closed'))
				// The application also stops on EOF. Bound the wait if it is stuck.
				void stop('control-disconnected').catch((error: Error) => settings.log(error.message))
			}
		})
	})
	listener.maxConnections = 16
	await new Promise<void>((resolve, reject) => {
		listener.once('error', reject)
		listener.listen(0, '127.0.0.1', resolve)
	})
	const address = listener.address()
	if (!address || typeof address === 'string')
		throw new Error('cannot create backend control endpoint')
	const dispose = () => {
		clearTimeout(startupTimer)
		for (const socket of sockets) socket.destroy()
		listener.close()
	}
	try {
		child = spawn(command.file, command.args ?? [], {
			...options,
			env: {
				...options.env,
				SWELTE_DEV_CONTROL: `127.0.0.1:${address.port}`,
				SWELTE_DEV_TOKEN: token,
				SWELTE_DEV_GENERATION: String(settings.generation),
				SWELTE_SHUTDOWN_TIMEOUT_MS: String(settings.shutdownMs),
				SWELTE_SHUTDOWN_SIGNALS: '0',
			},
		})
	} catch (error) {
		dispose()
		throw error
	}
	startupTimer = setTimeout(() => {
		ready.reject(new Error('backend did not report ready before the startup deadline'))
		void stop('startup-timeout').catch((error: Error) => settings.log(error.message))
	}, settings.startupMs ?? 30000)
	child.once('error', (error) => {
		ended = true
		ready.reject(error)
		exited.resolve({ code: null, signal: null })
		dispose()
	})
	child.once('exit', (code, signal) => {
		ended = true
		ready.reject(new Error(`backend exited before readiness (${signal ?? `code ${code}`})`))
		exited.resolve({ code, signal })
		dispose()
	})
	function stop(reason: string): Promise<void> {
		if (stopping) return stopping
		stopReason = reason
		clearTimeout(startupTimer)
		ready.reject(new Error('backend startup cancelled'))
		if (peer && !peer.destroyed) peer.write(`${JSON.stringify({ type: 'stop', reason })}\n`)
		stopping = (async () => {
			const forceFailed = deferred<never>()
			let confirmationTimer: NodeJS.Timeout | undefined
			const timer = setTimeout(() => {
				if (!ended) {
					settings.log(
						`backend shutdown exceeded ${settings.shutdownMs}ms; forcing the owned process to exit`
					)
					try {
						child.kill('SIGKILL')
					} catch (error) {
						forceFailed.reject(error as Error)
					}
					confirmationTimer = setTimeout(() => {
						forceFailed.reject(
							new Error(
								'cannot confirm backend exit after forced termination; refusing replacement'
							)
						)
					}, 5000)
				}
			}, settings.shutdownMs + 500)
			try {
				await Promise.race([exited.promise, forceFailed.promise])
			} finally {
				clearTimeout(timer)
				clearTimeout(confirmationTimer)
			}
		})()
		return stopping
	}
	return { child, ready: ready.promise, exited: exited.promise, stop }
}
