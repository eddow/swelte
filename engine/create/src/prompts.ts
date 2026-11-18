// Interactive prompts for `npm create @swelte` — @clack/prompts with graceful
// non-TTY fallback (CI / piped stdin: return defaults, never block).
import { cancel, confirm, intro, isCancel, outro, select, text } from '@clack/prompts'

/** True when we may draw an interactive widget. Honors --no-interactive,
// --yes (non-interactive), and CI env — not just isTTY. */
export function isInteractive(
	opts: Record<string, string | number | boolean | undefined>
): boolean {
	if (opts.yes === true || opts['no-interactive'] === true) return false
	if (process.env.CI === 'true' || process.env.CI === '1') return false
	return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/** Abort cleanly on Ctrl-C (clack symbol). */
function orCancel<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel('create-@swelte: cancelled.')
		process.exit(1)
	}
	return value as T
}

export async function promptDirName(initial: string): Promise<string> {
	const value = await text({
		message: 'Project directory',
		placeholder: initial,
		initialValue: initial,
		validate: (v: string | undefined) =>
			String(v ?? '').trim() ? undefined : 'Directory name is required',
	})
	return orCancel<string>(value).trim() || initial
}

export async function promptKind(): Promise<'app' | 'lib'> {
	const value = await select<'app' | 'lib'>({
		message: 'What are you building?',
		options: [
			{ value: 'app', label: 'App', hint: 'routes served' },
			{ value: 'lib', label: 'Library', hint: 'src/lib published, src/routes dogfood demo' },
		],
		initialValue: 'app',
	})
	return orCancel<'app' | 'lib'>(value)
}

export async function promptSample(): Promise<boolean> {
	const value = await confirm({
		message: 'Include sample routes (demo api/admin/files/users)?',
		initialValue: false,
	})
	return orCancel<boolean>(value)
}

export async function promptSsr(): Promise<boolean> {
	const value = await confirm({
		message:
			'Enable SSR via @swelte/ssr-qjs (else SPA-only; add later with `npm install @swelte/ssr-qjs`)?',
		initialValue: false,
	})
	return orCancel<boolean>(value)
}

export { intro, outro }
