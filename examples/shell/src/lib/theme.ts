// Theme: single source of truth for the shell example.
//
// Shared by the pre-hydration boot (`src/app.ts`) and the header toggle
// (`src/routes/+page.svelte`), so a stored preference is read and applied the
// same way in both places. daisyUI (`light --default, dark`) keys on
// `<html data-theme>`.

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'swelte-shell-theme'

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
export function preferredTheme(): Theme | null {
	// `null` = "no stored pref": callers fall back to the OS default via
	// matchMedia. Returning the raw stored value keeps SSR (no window) safe.
	try {
		return storedTheme()
	} catch {
		return null
	}
}

/** Set `<html data-theme>` — what daisyUI keys on. */
export function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme
}

/** Apply and remember — the user-initiated toggle. */
export function setTheme(theme: Theme): void {
	applyTheme(theme)
	persistTheme(theme)
}
