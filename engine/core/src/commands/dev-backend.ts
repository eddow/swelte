import type { DevApplication } from './dev-control.js'

export interface DevBackendOptions {
	build(generation: number): Promise<string>
	launch(binary: string, generation: number): Promise<DevApplication>
	discard(binary: string): Promise<void>
	log(message: string): void
}

/** One build/replacement at a time; changes during work supersede its candidate. */
export class DevBackend {
	private requested = 0
	private completed = 0
	private closing = false
	private running?: Promise<void>
	private application?: DevApplication
	private binary?: string
	private stopped?: Promise<void>
	private uiAction?: () => Promise<void>

	constructor(private readonly options: DevBackendOptions) {}

	restart(): Promise<void> {
		if (this.closing) return this.running ?? Promise.resolve()
		this.requested++
		return this.schedule()
	}

	restartUi(action: () => Promise<void>): Promise<void> {
		if (this.closing) return this.running ?? Promise.resolve()
		this.uiAction = action
		return this.schedule()
	}

	private schedule(): Promise<void> {
		if (!this.running) {
			this.running = this.pump().finally(() => {
				this.running = undefined
			})
		}
		return this.running
	}

	private async pump(): Promise<void> {
		while (!this.closing && (this.completed !== this.requested || this.uiAction)) {
			if (this.uiAction) {
				const action = this.uiAction
				this.uiAction = undefined
				try {
					await action()
				} catch (error) {
					this.options.log((error as Error).message)
				}
				continue
			}
			const generation = this.requested
			this.completed = generation
			let candidate: string | undefined
			try {
				candidate = await this.options.build(generation)
				if (this.closing || generation !== this.requested) continue
				await this.application?.stop('restart')
				if (this.binary) await this.options.discard(this.binary)
				this.application = undefined
				this.binary = undefined
				if (this.closing || generation !== this.requested) continue
				this.binary = candidate
				candidate = undefined
				const application = await this.options.launch(this.binary, generation)
				this.application = application
				if (this.closing) await application.stop('quit')
				else {
					await application.ready
					this.options.log(`V backend ready (generation ${generation})`)
				}
			} catch (error) {
				if (!this.closing) this.options.log((error as Error).message)
			} finally {
				if (candidate) await this.options.discard(candidate)
			}
		}
	}

	stop(): Promise<void> {
		if (this.stopped) return this.stopped
		this.closing = true
		this.stopped = (async () => {
			await this.application?.stop('quit')
			await this.running
			await this.application?.stop('quit')
			if (this.binary) await this.options.discard(this.binary)
		})()
		return this.stopped
	}
}
