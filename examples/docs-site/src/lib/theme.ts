// Theme: single source of truth for the docs-site.
//
// Shared by the pre-hydration boot (`src/app.ts`) and the navbar toggle
// (`+route.svelte`), so a stored preference is read and applied the same way
// in both places. daisyUI (`light --default, dark`) and the shiki dual-theme
// rules in `app.css` both key on `<html data-theme>`.

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'swelte-docs-theme'

/** Persisted preference, or `null` when unset (or storage is blocked). */
export function storedTheme(): Theme | null {
	try {
		const raw = localStorage.getItem(THEME_KEY)
		return raw === 'dark' || raw === 'light' ? raw : null
	} catch {
		return null // private mode — no persisted preference
	}
}

/** Persist the preference (best-effort; blocked storage is not fatal). */
export function persistTheme(theme: Theme): void {
	try {
		localStorage.setItem(THEME_KEY, theme)
	} catch {
		// private mode — theme just won't persist
	}
}

/** Stored preference when present, else the OS default. */
export function preferredTheme(): Theme {
	return (
		storedTheme() ??
		(window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
	)
}

/** Set `<html data-theme>` — what daisyUI + the shiki rules key on. */
export function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme
}

/** Apply and remember — the user-initiated toggle. */
export function setTheme(theme: Theme): void {
	applyTheme(theme)
	persistTheme(theme)
}
