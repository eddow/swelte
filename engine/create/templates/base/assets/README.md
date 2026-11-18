// Project-local images for `swelte build` (`docs/images.md`):
// `svelte.config.js` → `swelte: { images: [{ src: 'assets/hero.png',
// widths: [320, 640, 1280] }] }` — host-native PNG/JPEG resize to WebP,
// emitted as `dist/images/*` (import the generated metadata via
// `#app/images` in a component). Source files are build INPUTS only, read
// with `readFileSync` — they are never bundled by Vite and never copied to
// `dist/` by this pipeline, so this dir needs no Vite config. For files
// you want served verbatim (favicon, `robots.txt`), use Vite's default
// `public/` dir instead (served at `/`, copied to `dist/`).
//
// This file keeps the (otherwise empty) directory in git — delete it once
// you add your first image.
