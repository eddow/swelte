/**
 * Themed code block for the docs-site.
 *
 * SSR-safe by construction: the highlighted HTML is computed at *build
 * time* by `scripts/highlight-code.ts` (runs in Node, writes
 * `src/lib/code-snippets.gen.ts`) and rendered here as static markup.
 * Nothing async, no `fetch`, no `node:` imports, no WASM — the sync
 * QuickJS renderer just interpolates the string.
 *
 * Dual light/dark theming comes from shiki's `themes: { light, dark }`
 * output: each token carries `--shiki-light` / `--shiki-dark` CSS vars
 * and `app.css` selects per `data-theme`. So a block themes instantly
 * with the toggle — no re-highlight on switch.
 */
export interface CodeSnippet {
	/** highlighted HTML fragment (inner content of the <pre>) */
	html: string;
	/** shiki language id used (for a11y / debugging) */
	lang: string;
}
