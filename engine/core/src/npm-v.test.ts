import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import {
	materializeNpmV,
	npmVNamespace,
	parseNpmVSpecifier,
} from './vite/npm-v.js'

function fixture(target: 'universal' | 'server' = 'universal'): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-npm-v-'))
	const packageRoot = join(root, 'node_modules', '@acme', 'validation')
	mkdirSync(join(packageRoot, 'vlib', 'phone'), { recursive: true })
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ dependencies: { '@acme/validation': '1.2.3' } })
	)
	writeFileSync(
		join(packageRoot, 'package.json'),
		JSON.stringify({
			name: '@acme/validation',
			version: '1.2.3',
			swelte: {
				v: {
					exports: {
						'./phone.v': {
							source: './vlib/phone',
							entry: './vlib/phone/api.v',
							target,
						},
					},
				},
			},
		})
	)
	writeFileSync(
		join(packageRoot, 'vlib', 'phone', 'api.v'),
		`module phone

pub struct NormalizeArgs {
pub:
	input string
}

@[rpc]
pub fn normalize(args NormalizeArgs) string {
	return args.input
}
`
	)
	writeFileSync(
		join(packageRoot, 'vlib', 'phone', 'helper.v'),
		'module phone\n\npub fn helper(s string) string { return s }\n'
	)
	return root
}

describe('npm V packages', () => {
	it('maps npm specifiers to a reserved V namespace', () => {
		assert.equal(npmVNamespace('@acme/validation'), 'npm_acme_validation')
		assert.deepEqual(parseNpmVSpecifier('@acme/validation/v/text/slug.v'), {
			packageName: '@acme/validation',
			exportKey: './text/slug.v',
		})
		assert.deepEqual(parseNpmVSpecifier('validation/v/phone.v'), {
			packageName: 'validation',
			exportKey: './phone.v',
		})
		assert.equal(parseNpmVSpecifier('#lib/phone.v'), null)
	})

	it('materializes the complete declared module and records its origin', () => {
		const root = fixture()
		const genDir = join(root, '.swelte')
		const exports = materializeNpmV(root, genDir)
		assert.equal(exports.length, 1)
		assert.equal(exports[0].specifier, '@acme/validation/v/phone.v')
		assert.equal(exports[0].moduleImport, 'npm_acme_validation.phone')
		assert.equal(exports[0].target, 'universal')
		assert.match(
			readFileSync(join(genDir, 'npm_acme_validation', 'phone', 'api.v'), 'utf8'),
			/@\[rpc\]/
		)
		assert.match(
			readFileSync(join(genDir, 'npm_acme_validation', 'phone', 'helper.v'), 'utf8'),
			/pub fn helper/
		)
		const marker = JSON.parse(readFileSync(join(genDir, 'npm_v_modules.json'), 'utf8'))
		assert.deepEqual(marker.namespaces, ['npm_acme_validation'])
		assert.equal(marker.exports[0].version, '1.2.3')
		writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: {} }))
		assert.deepEqual(materializeNpmV(root, genDir), [])
		assert.equal(existsSync(join(genDir, 'npm_acme_validation')), false)
	})

	it('rejects package exports whose module declaration does not match the logical path', () => {
		const root = fixture('server')
		writeFileSync(
			join(root, 'node_modules', '@acme', 'validation', 'vlib', 'phone', 'api.v'),
			'module wrong\n'
		)
		assert.throws(() => materializeNpmV(root, join(root, '.swelte')), /expected phone/)
	})

	it('keeps server exports available to V but rejects browser imports', async () => {
		const root = fixture('server')
		mkdirSync(join(root, 'src', 'routes'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		const { swelte } = await import('./vite.js')
		const plugin = swelte() as unknown as {
			configResolved(config: { root: string }): void
			buildStart(): Promise<void>
			resolveId(source: string, importer: string, options: object): Promise<string | null>
		}
		plugin.configResolved({ root })
		await plugin.buildStart()
		assert.equal(
			existsSync(join(root, '.swelte', 'npm_acme_validation', 'phone', 'api.v')),
			true
		)
		await assert.rejects(
			() =>
				plugin.resolveId.call(
					{},
					'@acme/validation/v/phone.v',
					join(root, 'src', 'consumer.ts'),
					{}
				),
			/server-only/
		)
	})

	it('generates declarations and a browser stub for a universal package export', async () => {
		const root = fixture()
		mkdirSync(join(root, 'src', 'routes', 'api'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'routes', 'api', 'probe.v'),
			`module probe

import npm_acme_validation.phone

@[get]
pub fn probe() string {
	return phone.helper('ok')
}
`
		)
		writeFileSync(
			join(root, 'src', 'lib', 'use-phone.v'),
			`module use_phone

import npm_acme_validation.phone

pub struct UsePhoneArgs {
pub:
	input string
}

@[rpc]
pub fn use_phone(args UsePhoneArgs) string {
	return phone.helper(args.input)
}
`
		)
		const { swelte } = await import('./vite.js')
		const plugin = swelte() as unknown as {
			configResolved(config: { root: string }): void
			buildStart(): Promise<void>
			resolveId(source: string, importer: string, options: object): Promise<string | null>
			load(id: string): Promise<string | null>
			generateBundle(options: object, bundle: Record<string, unknown>): void
		}
		plugin.configResolved({ root })
		await plugin.buildStart()
		const id = await plugin.resolveId.call(
			{},
			'@acme/validation/v/phone.v',
			join(root, 'src', 'consumer.ts'),
			{}
		)
		assert.match(String(id), /^\0swelte:npm-v:/)
		const stub = await plugin.load.call({}, String(id))
		assert.match(String(stub), /export function normalize/)
		assert.match(
			readFileSync(join(root, '.swelte', 'v-shim.d.ts'), 'utf8'),
			/declare module '@acme\/validation\/v\/phone\.v'/
		)
		assert.match(
			readFileSync(join(root, '.swelte', 'types', 'npm', 'npm_acme_validation', 'phone.d.ts'), 'utf8'),
			/export function normalize/
		)
		assert.match(
			readFileSync(join(root, '.swelte', 'routes', 'api_probe.v'), 'utf8'),
			/import npm_acme_validation\.phone/
		)
		assert.equal(
			existsSync(join(root, '.swelte', 'dev', 'use-phone.wasm')),
			true,
			'application #lib modules can import npm V modules during dev compilation'
		)
		let emitted = false
		plugin.generateBundle.call(
			{
				emitFile(asset: { source?: Uint8Array }) {
					emitted = (asset.source?.byteLength ?? 0) > 0
					return 'npm-v-wasm'
				},
				getFileName() {
					return 'assets/app_lib-NPMV.wasm'
				},
			},
			{},
			{}
		)
		assert.equal(emitted, true, 'production bundle includes the used npm V module')
	})
})
