# Swelte brand assets

The Swelte mark is a composition of the two official logos it is built from:

- **Svelte** — the orange ribbon "S", from the [official Svelte branding repo](https://github.com/sveltejs/branding)
  (`svelte-logo.svg`, 107×128 artboard, orange `#ff3e00` + white flash).
- **V** — the blue "V", from the [official V repository](https://github.com/vlang/v)
  (`examples/veb/veb_assets/assets/v-logo.svg`, 500×500 artboard, `#536b8a` / `#5d87be`).

Only the original path data is used — nothing is redrawn or restyled. The two marks are
placed so that the Svelte "S" nests in the valley of the "V", and a transparent "moat"
(an SVG `mask`) separates them. Because the separation is transparent rather than a white
outline, the mark works on light, dark, and photographic backgrounds.

## Files

| File | Use |
| --- | --- |
| [`swelte-icon.svg`](./swelte-icon.svg) | Primary mark. Two-colour (Svelte orange + V blue). |
| [`swelte-icon-mono.svg`](./swelte-icon-mono.svg) | Single colour via `currentColor`; the Svelte flash is a real hole. For inline SVG, badges, and favicons. |
| [`swelte-icon-tile.svg`](./swelte-icon-tile.svg) | Rounded app-icon tile, for avatars and home-screen icons. |

All three share a 512×512 `viewBox`, so they scale from 16 px favicons to print.

`examples/docs-site/public/favicon.svg` is a copy of `swelte-icon.svg` — Vite serves
`public/` verbatim, and committing the file keeps the deploy path (including the
`build:vercel` Docker upload) free of any build-time dependency on `assets/`.

## Usage

Inline SVG inherits the page text colour in the mono variant:

```html
<a class="brand">
	<svg viewBox="0 0 512 512" width="28" height="28" aria-hidden="true">
		<!-- contents of swelte-icon-mono.svg -->
	</svg>
	Swelte
</a>
```

As an image:

```html
<link rel="icon" href="/assets/swelte-icon.svg" type="image/svg+xml" />
<img src="/assets/swelte-icon.svg" alt="Swelte" width="32" height="32" />
```

## Regenerating

The source logos are fetched from upstream and combined by a small script; the path data
is never edited by hand.

```bash
curl -o /tmp/svelte-logo.svg https://raw.githubusercontent.com/sveltejs/branding/master/svelte-logo.svg
curl -o /tmp/v-logo.svg https://raw.githubusercontent.com/vlang/v/master/examples/veb/veb_assets/assets/v-logo.svg
python3 scripts/build-brand-assets.py
```

> Note: the Svelte mark comes from the Svelte branding repo; check Svelte's brand guidelines
> before using it in a way that implies endorsement.
