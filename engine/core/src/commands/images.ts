import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCC, resolveV, toolchainEnv } from '../toolchain.js'

export interface ImageOptions {
	src: string
	widths: number[]
	quality?: number
}
export interface ImageVariant {
	src: string
	width: number
	height: number
	format: 'webp'
}
export type ImageManifest = Record<string, ImageVariant[]>

export function normalizeImages(raw: unknown): ImageOptions[] {
	if (raw === undefined) return []
	if (!Array.isArray(raw)) throw new Error('swelte.images must be an array')
	const seen = new Set<string>()
	return raw.map((input: ImageOptions) => {
		if (
			!input ||
			typeof input.src !== 'string' ||
			!/\.(png|jpe?g)$/i.test(input.src) ||
			seen.has(input.src)
		)
			throw new Error('images require unique PNG/JPEG source paths')
		if (
			!Array.isArray(input.widths) ||
			input.widths.length === 0 ||
			input.widths.length > 20 ||
			input.widths.some((width) => !Number.isInteger(width) || width < 1 || width > 8192)
		)
			throw new Error('image widths must be integers from 1 to 8192 (at most 20 variants)')
		const quality = input.quality ?? 80
		if (!Number.isInteger(quality) || quality < 1 || quality > 100)
			throw new Error('image quality must be 1..100')
		seen.add(input.src)
		return { src: input.src, widths: [...new Set(input.widths)].sort((a, b) => a - b), quality }
	})
}

/** Host-only compiler; the production server gains no image/codec dependency. */
export function buildImages(
	root: string,
	options: ImageOptions[],
	outDir = '.swelte',
	base = ''
): ImageManifest {
	options = normalizeImages(options)
	const generated = resolve(root, outDir)
	mkdirSync(generated, { recursive: true })
	let manifest: ImageManifest = {}
	if (options.length) {
		const scratch = mkdtempSync(join(generated, '.images-build-'))
		try {
			const project = realpathSync(root)
			const inputs = options.map((input) => {
				const file = realpathSync(resolve(root, input.src))
				if (!file.startsWith(project + sep))
					throw new Error(`image source escapes project: ${input.src}`)
				const key = createHash('sha256')
					.update('swelte-image-v1')
					.update(readFileSync(file))
					.update(JSON.stringify(input))
					.digest('hex')
					.slice(0, 24)
				return { ...input, file, key }
			})
			const input = join(scratch, 'input.json')
			writeFileSync(input, JSON.stringify(inputs))
			const executable = join(scratch, process.platform === 'win32' ? 'images.exe' : 'images')
			const template = new URL('../../templates/images/main.v', import.meta.url)
			execFileSync(
				resolveV(import.meta.url),
				['-cc', resolveCC(), '-o', executable, fileURLToPath(template)],
				{ env: toolchainEnv(), stdio: 'pipe', timeout: 120000 }
			)
			manifest = JSON.parse(
				execFileSync(executable, [input, join(scratch, 'output')], {
					encoding: 'utf8',
					timeout: 120000,
				})
			)
			const assets = join(generated, '.images')
			mkdirSync(assets, { recursive: true })
			for (const variants of Object.values(manifest))
				for (const variant of variants) {
					renameSync(join(scratch, 'output', variant.src), join(assets, variant.src))
					variant.src = `${base}/images/${variant.src}`
				}
		} finally {
			rmSync(scratch, { recursive: true, force: true })
		}
	}
	writeFileSync(join(generated, 'images.js'), `export default ${JSON.stringify(manifest)};\n`)
	return manifest
}
