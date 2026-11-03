<script lang="ts">
	import type { Snippet } from 'svelte'
	import { onMount } from 'svelte'
	import { searchDocs } from '#lib/search.js'
	import { goto } from '@swelte/core'
	import { browser } from '#app/environment'

	let { children }: { children?: Snippet } = $props()

	const THEME_KEY = 'swelte-docs-theme'

	// System default first (no stored pref → OS decides via CSS),
	// then explicit light/dark persisted in localStorage.
	// Client-only: runs in onMount, never during SSR.
	let dark = $state(false)

	let query = $state('')
	let open = $state(false)
	let active = $state(0)
	// SSR-safe: searchDocs is plain client data (static index, no RPC).
	// Evaluate lazily only in the browser render — the server bundle
	// renders the shell (query starts empty) and hydrates interactivity.
	let results = $derived(typeof window === 'undefined' ? [] : searchDocs(query))

	function applyTheme(next: boolean) {
		dark = next
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = next ? 'dark' : 'light'
			try {
				localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
			} catch {
				// private mode — theme just won't persist
			}
		}
	}

	// Guards register client-side only: they must never fire during the
	// sync SSR render (no router/stores in QJS — build error by design).
	// NOTE: plain onMount still fires inside Svelte's sync server render,
	// so guard with a browser check (false on the server output, so the
	// calls are tree-shaken before QJS ever sees them).
	// `#app/*` imports are SSR-safe (server literals in the sync bundle);
	// only `@swelte/core` store *values* ($page/$navigating/$updated) and
	// router fns need the browser gate (throw-stubs in QJS).
	if (browser) {
		onMount(() => {
			const root = document.documentElement
			let stored: string | null = null
			try {
				stored = localStorage.getItem(THEME_KEY)
			} catch {
				stored = null
			}
			if (stored === 'dark' || stored === 'light') {
				// Boot script already applied this; just sync the toggle.
				dark = stored === 'dark'
				root.dataset.theme = stored
			} else {
				// No stored pref: follow the OS, then adopt it as explicit state
				// (toggle shows the truth; next flip persists from here).
				applyTheme(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
			}
			const onKey = (e: KeyboardEvent) => {
				const t = e.target as HTMLElement | null
				const typing = t != null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
				if (e.key === '/' && !typing) {
					e.preventDefault()
					const el = document.querySelector(
						'input[aria-label="Search docs"]'
					) as HTMLInputElement | null
					el?.focus()
				}
			}
			window.addEventListener('keydown', onKey)
			return () => window.removeEventListener('keydown', onKey)
		})
	}

	const groups: { title: string; links: { href: string; label: string }[] }[] = [
		{
			title: 'Start',
			links: [
				{ href: '/', label: 'Overview' },
				{ href: '/install', label: 'Installation' },
				{ href: '/quickstart', label: 'Quickstart' }
			]
		},
		{
			title: 'Guide',
			links: [
				{ href: '/guide/rpc', label: 'RPC & routes' },
				{ href: '/guide/types', label: 'Types' },
				{ href: '/guide/forms', label: 'Forms' },
				{ href: '/guide/errors', label: 'Errors' },
				{ href: '/guide/config', label: 'Config' },
				{ href: '/guide/offline', label: 'Offline' },
				{ href: '/guide/ssr', label: 'SSR' },
				{ href: '/guide/cli', label: 'CLI' },
				{ href: '/guide/mcp', label: 'MCP' }
			]
		},
		{
			title: 'Migrate',
			links: [
				{ href: '/from-sveltekit', label: 'From SvelteKit' },
				{ href: '/versus', label: 'Versus' },
				{ href: '/example', label: 'Example app' }
			]
		}
	]
</script>

<div class="drawer lg:drawer-open min-h-screen">
	<input id="docs-drawer" type="checkbox" class="drawer-toggle" />
	<div class="drawer-content flex flex-col">
		<div class="navbar bg-base-100 border-b border-base-200 sticky top-0 z-10">
			<div class="flex-none lg:hidden">
				<label for="docs-drawer" aria-label="open sidebar" class="btn btn-square btn-ghost">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						class="inline-block h-5 w-5 stroke-current"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						></path>
					</svg>
				</label>
			</div>
			<div class="flex-1 px-2">
				<a href="/" class="btn btn-ghost text-xl normal-case">Swelte</a>
				<span class="badge badge-primary hidden sm:inline-flex">V + Svelte 5</span>
			</div>
			<div class="flex-none gap-2">
				<div class="relative hidden md:block">
					<label class="input input-bordered input-sm flex items-center gap-2">
						<input
							type="text"
							class="grow"
							placeholder="Search docs…"
							bind:value={query}
							onfocus={() => (open = true)}
							onblur={() => setTimeout(() => (open = false), 120)}
							onkeydown={(e) => {
								if (e.key === 'ArrowDown') {
									e.preventDefault()
									active = Math.min(active + 1, results.length - 1)
								} else if (e.key === 'ArrowUp') {
									e.preventDefault()
									active = Math.max(active - 1, 0)
								} else if (e.key === 'Enter' && results[active]) {
									const href = results[active].href
									query = ''
									open = false
									active = 0
									try {
										goto(href)
									} catch {
										window.location.href = href
									}
								} else if (e.key === 'Escape') {
									query = ''
									open = false
								}
							}}
							aria-label="Search docs"
							role="combobox"
							aria-expanded={open && results.length > 0}
							aria-controls="docs-search-list"
						/>
						<kbd class="kbd kbd-xs">/</kbd>
					</label>
					{#if open && query.trim() && results.length > 0}
						<ul
							id="docs-search-list"
							role="listbox"
							class="absolute right-0 mt-1 w-72 menu bg-base-100 border border-base-200 rounded-box shadow-lg z-30 p-1"
						>
							{#each results as r, i}
								<li>
									<button
										role="option"
										aria-selected={i === active}
										class={i === active ? 'active' : ''}
										onmousedown={(e) => {
											e.preventDefault()
											const href = r.href
											query = ''
											open = false
											active = 0
											try {
												goto(href)
											} catch {
												window.location.href = href
											}
										}}>{r.label} <span class="opacity-60 text-xs">· {r.group}</span></button
									>
								</li>
							{/each}
						</ul>
					{:else if open && query.trim()}
						<div
							class="absolute right-0 mt-1 w-72 bg-base-100 border border-base-200 rounded-box shadow-lg z-30 p-3 text-sm opacity-70"
						>
							No matches — try “ssr”, “offline”, or “rpc”.
						</div>
					{/if}
				</div>
				<label class="swap swap-rotate btn btn-ghost btn-circle btn-sm">
					<input
						type="checkbox"
						checked={dark}
						onchange={(e) => applyTheme(e.currentTarget.checked)}
						aria-label="Toggle dark mode"
					/>
					<svg
						class="swap-off h-5 w-5 fill-current"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
					>
						<path
							d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7A1,1,0,0,0,12,4V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05l.71-.71A1,1,0,0,0,7.76,7.76l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0A1,1,0,0,0,5.64,7.05ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
						/>
					</svg>
					<svg
						class="swap-on h-5 w-5 fill-current"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
					>
						<path
							d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"
						/>
					</svg>
				</label>
				<a href="https://github.com/eddow/swelte" class="btn btn-ghost btn-sm hidden sm:inline-flex"
					>GitHub</a
				>
			</div>
		</div>
		<main class="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
			{@render children?.()}
		</main>
		<footer class="footer footer-center bg-base-200 text-base-content p-6 mt-8">
			<aside>
				<p class="font-bold">Swelte — V + Svelte full-stack</p>
				<p class="text-sm opacity-70">Agents in, binaries out.</p>
			</aside>
		</footer>
	</div>
	<div class="drawer-side z-20">
		<label for="docs-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
		<aside class="menu bg-base-100 min-h-full w-72 p-4 border-r border-base-200">
			{#each groups as group}
				<li class="menu-title">{group.title}</li>
				<ul>
					{#each group.links as link}
						<li><a href={link.href}>{link.label}</a></li>
					{/each}
				</ul>
			{/each}
			<div class="divider"></div>
			<div class="px-2 text-xs opacity-60">
				<p>Source of truth lives in <code>docs/*.md</code>.</p>
				<p>This site renders it — same content, browseable.</p>
			</div>
		</aside>
	</div>
</div>
