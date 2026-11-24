# Build-time images

> Detailed reference for the [capability contract](spec.md). Implementation
> notes and measurements describe their stated scope, not additional guarantees.

`swelte build` can resize project-local PNG/JPEG files and emit WebP variants.
The build compiles a V tool using `stbi` and libwebp on the build host. Install
libwebp development files and pkg-config there (`libwebp-dev` on Debian/Ubuntu,
`webp` on Homebrew). The production server needs neither the tool nor libwebp.

Configure the assets in `svelte.config.js`:

```js
export default {
  swelte: {
    images: [{ src: 'assets/hero.png', widths: [320, 640, 1280], quality: 80 }]
  }
}
```

Sources must resolve inside the project, including after following symlinks.
Widths are integers from 1 to 8192, at most 20 per source. Quality is 1–100
(default 80). Source images are limited to 64 million pixels. Each variant
preserves aspect ratio, never upscales, and keeps PNG alpha. Repeated effective
widths collapse into one variant. Metadata is stripped; EXIF orientation is not
applied, so use sources whose pixels already have the intended orientation.

Import the generated metadata in a component:

```svelte
<script>
  import images from '#app/images'
  const variants = images['assets/hero.png']
  const largest = variants[variants.length - 1]
</script>

<img src={largest.src}
  srcset={variants.map(image => `${image.src} ${image.width}w`).join(', ')}
  width={largest.width} height={largest.height} alt="Hero" />
```

The contract is `Record<string, { src, width, height, format: 'webp' }[]>`,
keyed by the configured source path, ordered by ascending width. `src` includes
`swelte.base`. The same module resolves in client and SSR builds. With no
configured assets it exports an empty object. Image processing runs during
`swelte build`; dev can use metadata from the last build.

Outputs are `dist/images/<input-and-options-hash>-<width>.webp` and
`dist/images/manifest.json`. Only referenced variants are copied into `dist`;
originals are not copied by this pipeline. Generated metadata and intermediate
assets live under the configured `outDir`. A failed decode, resize or encode
fails the build. Cross-compiling the app still processes images on the host.

Run `npm run test:e2e` (images step) to exercise resizing, decoding the actual WebP output,
alpha, dimension bounds and stable asset names (cherry-pick: `node scripts/test-images.mjs`). It requires the build dependencies
above; no image service or external executable encoder is used.
