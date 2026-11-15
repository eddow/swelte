<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Images</li>
	</ul>
</div>
<h1 class="text-4xl font-bold mt-2">Build-time images</h1>
<p class="py-4 opacity-80">
	Resize project-local PNG/JPEG files into WebP variants during <code>swelte build</code>. A
	host-side V tool uses <code>stbi</code> and libwebp; the production server needs neither the tool
	nor the codec library.
</p>
<div class="alert alert-info text-sm">
	<span>
		Install libwebp development files and pkg-config on the build host:
		<code>libwebp-dev</code>
		on Debian/Ubuntu, or <code>webp</code> on Homebrew. Cross-compiling the server still processes
		images on the host.
	</span>
</div>
<h2 class="text-2xl font-bold mt-8">Configure variants</h2>
<div class="mt-2"><Code snippet={codeHtml['images-config']} dense title="svelte.config.js" /></div>
<p class="opacity-80 mt-2">
	Sources must resolve inside the project, including after following symlinks. Widths are integers
	from 1 to 8192, at most 20 per source. Quality is 1–100 (default 80), and sources are limited to
	64 million pixels. Variants preserve aspect ratio, never upscale and keep PNG alpha. Repeated
	effective widths collapse into one output.
</p>
<h2 class="text-2xl font-bold mt-8">Use generated metadata</h2>
<div class="mt-2">
	<Code snippet={codeHtml['images-component']} dense title="src/routes/+page.svelte" />
</div>
<p class="opacity-80 mt-2">
	<code>#app/images</code>
	exports an object keyed by the configured source path. Each value is an array of <code>src</code>,
	<code>width</code>, <code>height</code> and <code>format: 'webp'</code>
	objects, ordered by ascending width. URLs include <code>swelte.base</code>. The same module
	resolves in client and SSR builds; with no configured images it exports an empty object.
</p>
<h2 class="text-2xl font-bold mt-8">Outputs and limits</h2>
<ul class="list-disc list-inside opacity-80 space-y-2 mt-2">
	<li>
		<code>dist/images/&lt;input-and-options-hash&gt;-&lt;width&gt;.webp</code>
		contains the variants.
	</li>
	<li>
		<code>dist/images/manifest.json</code>
		publishes the metadata. Only referenced variants are copied into the build.
	</li>
	<li>
		Originals are not copied by this pipeline. Generated metadata and intermediate assets live under
		<code>outDir</code>.
	</li>
	<li>
		Processing runs during <code>swelte build</code>; dev can use metadata from the last build.
	</li>
	<li>
		Metadata is stripped and EXIF orientation is not applied. Use sources whose pixels already have
		the intended orientation.
	</li>
	<li>Decode, resize or encode failures fail the build.</li>
</ul>
<DocsNav
	next={{ href: '/guide/offline', label: 'Offline & outbox' }}
	related={[
		{ href: '/guide/config', label: 'Config' },
		{ href: '/guide/isr', label: 'ISR' },
	]}
/>
