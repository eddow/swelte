import type { ChildProcess } from 'node:child_process'

/** Attach immediately after spawn so spawn errors and fast exits are observed. */
export function childExit(child: ChildProcess, label: string): Promise<void> {
	return new Promise((resolve, reject) => {
		child.once('error', reject)
		child.once('exit', (code, signal) => {
			if (code === 0) resolve()
			else reject(new Error(`${label} exited (${signal ?? `code ${code}`})`))
		})
	})
}
