// `swelte deploy`: deployment-config automater (setup only — never ships).
// Prebuilt model: `npm run build` (linux/amd64 from the package.json
// declaration) produces dist/ + dist/server, then the platform CLI uploads
// (`vercel deploy`). `npm run build:local` forces host-native for local
// preview (`swelte preview`). This command generates the wrapper files +
// patches package.json swelte.targetOs/targetArch (which @swelte/vvm
// postinstall reads on `npm i` to prep zig).
// Subcommands: `init` (default, writes) / `status` (read-only drift check).
// Targets: `vercel` (Dockerfile.vercel + .dockerignore + .vercelignore),
// `docker` (Dockerfile + .dockerignore), `fly` (Dockerfile + fly.toml),
// `railway` (Dockerfile + railway.json), `render` (Dockerfile + render.yaml),
// `static` (packaging-only: asserts `swelte build --target static`, no files).
// No new scripts are added: exactly two builds exist — `build` (deploy
// target when declared, else this machine) and `build:local` (always this
// machine) — and the ship commands (`vercel deploy`, `docker build`,
// `fly deploy`, ...) are one-liners documented in the Dockerfile + README,
// not scripts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { Ctx } from './types.js'

export type DeployTarget = 'vercel' | 'docker' | 'fly' | 'railway' | 'render' | 'static'
export type DeploySub = 'init' | 'status'

const SUPPORTED: DeployTarget[] = ['vercel', 'docker', 'fly', 'railway', 'render', 'static']

/** Platform config file generated alongside the Dockerfile (none for docker/vercel). */
export function targetConfigFile(target: DeployTarget): string | null {
	switch (target) {
		case 'fly':
			return 'fly.toml'
		case 'railway':
			return 'railway.json'
		case 'render':
			return 'render.yaml'
		default:
			return null
	}
}

/** One-line ship command for the README recipe + `next:` log. */
export function targetShipCommand(
	target: DeployTarget,
	appName: string,
	dockerfile: string
): string {
	switch (target) {
		case 'vercel':
			return 'vercel deploy --prod'
		case 'docker':
			return `docker build -t ${appName} . -f ${dockerfile}`
		case 'fly':
			return 'fly deploy'
		case 'railway':
			return 'railway up'
		case 'render':
			return 'git push  # Render auto-deploys the render.yaml Blueprint'
		case 'static':
			return 'swelte build --target static'
	}
}

export interface FileDrift {
	file: string
	state: 'ok' | 'missing' | 'drift'
}

function defaultDockerfile(target: DeployTarget, explicit: unknown): string {
	if (typeof explicit === 'string' && explicit.trim() !== '')
		return basename(String(explicit).trim())
	return target === 'vercel' ? 'Dockerfile.vercel' : 'Dockerfile'
}

function readPkg(root: string): { raw: string | null; json: Record<string, unknown> } {
	const p = join(root, 'package.json')
	try {
		const raw = readFileSync(p, 'utf8')
		return { raw, json: JSON.parse(raw) as Record<string, unknown> }
	} catch {
		return { raw: null, json: {} }
	}
}

function hasSsrDep(pkg: Record<string, unknown>): boolean {
	for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
		const d = (pkg as Record<string, unknown>)[k]
		if (d && typeof d === 'object' && '@swelte/ssr-qjs' in (d as Record<string, unknown>))
			return true
	}
	return false
}

export function renderDockerfile(opts: {
	target: DeployTarget
	dockerfile: string
	distDir: string
	ssr: boolean
	rootRel?: string | null
	appName: string
}): string {
	const { target, dockerfile, distDir, ssr, appName } = opts
	// The recipe names `npm run build`: with a `swelte.targetOs/targetArch`
	// declaration it cross-builds for the deploy target, else host-native.
	const buildCmd = 'npm run build'
	const heads: Record<DeployTarget, string> = {
		vercel: `# Manual Vercel prebuilt deploy for ${appName} (Swelte: V binary + ${distDir}/).\n# Vercel builds THIS file in the cloud from uploaded LOCAL ${distDir}/ output —\n# no Node, no V toolchain, no zig in the cloud. Build locally first:\n#\n#   ${buildCmd.padEnd(24)} # swelte build → linux/amd64 from package.json\n#   vercel deploy            # preview URL\n#   vercel deploy --prod     # production\n#\n`,
		docker: `# Prebuilt deploy for ${appName} (Swelte: V binary + ${distDir}/).\n# Build locally first (linux/amd64), then build this image:\n#\n#   ${buildCmd.padEnd(24)} # swelte build → linux/amd64 from package.json\n#   docker build -t ${appName} . -f ${dockerfile}\n#\n`,
		fly: `# Fly.io prebuilt deploy for ${appName} (Swelte: V binary + ${distDir}/).\n# Build locally first (linux/amd64); fly builds THIS Dockerfile in its cloud\n# from the uploaded LOCAL ${distDir}/ output:\n#\n#   ${buildCmd.padEnd(24)} # swelte build → linux/amd64 from package.json\n#   fly deploy               # reads fly.toml, serves internal_port 8131\n#\n`,
		railway: `# Railway prebuilt deploy for ${appName} (Swelte: V binary + ${distDir}/).\n# Build locally first (linux/amd64); Railway builds THIS Dockerfile from the\n# uploaded LOCAL ${distDir}/ output:\n#\n#   ${buildCmd.padEnd(24)} # swelte build → linux/amd64 from package.json\n#   railway up               # builder auto-detects the Dockerfile\n#\n`,
		render: `# Render prebuilt deploy for ${appName} (Swelte: V binary + ${distDir}/).\n# Build locally first (linux/amd64); Render builds THIS Dockerfile in its\n# cloud from the uploaded LOCAL ${distDir}/ output (see render.yaml):\n#\n#   ${buildCmd.padEnd(24)} # swelte build → linux/amd64 from package.json\n#   git push                 # Render auto-deploys the Blueprint\n#\n`,
		static: '',
	}
	const head = heads[target]
	const mid = `# The \`swelte.targetOs/targetArch\` in package.json is the deploy target:\n# \`@swelte/vvm\` postinstall preps the machine on \`npm i\` (zig +\n# zig-cc-linux-amd64 wrapper), and plain \`swelte build\` reads it — no\n# flags needed. \`npm run build:local\` (\`swelte build --local\`) forces a\n# host-native build for local preview, ignoring the declaration.\n`
	const vcfg =
		target === 'vercel'
			? opts.rootRel
				? `# Vercel project settings (dashboard → project → Settings):\n#   Root Directory: ${opts.rootRel}\n#   Dockerfile Path: ${dockerfile}  (default when only one Dockerfile.* exists)\n#\n`
				: `# Vercel project settings (dashboard → project → Settings):\n#   Dockerfile Path: ${dockerfile}  (default when only one Dockerfile.* exists)\n#\n`
			: ''
	const ssrNote = ssr
		? `# - SSR is embedded QuickJS: SWELTE_SSR=1 reads ${distDir}/ssr/render.js in-process.\n`
		: `# - SPA-only (no @swelte/ssr-qjs): SWELTE_SSR unset, binary serves ${distDir}/ + API.\n`
	const ctxNote =
		target === 'vercel'
			? `# - \`${distDir}/\` is gitignored but MUST be in the upload context: \`.vercelignore\`\n#   allowlists it explicitly (Vercel excludes gitignored output by default).\n`
			: `# - \`${distDir}/\` is gitignored but MUST be in the context — see .dockerignore.\n`
	return `${head}${mid}${vcfg}# Notes:\n${ctxNote}# - \`.dockerignore\` excludes everything except ${distDir}/ + this Dockerfile —\n#   the context stays small and no source/toolchain leaks in.\n${ssrNote}# - $PORT is injected by the platform — the default (8131) only applies\n#   to local \`docker run\` without -e PORT. No EXPOSE needed for Vercel\n#   (kept for \`docker run\`).\n# - glibc floor: zig targets x86_64-linux-gnu; the debian:stable-slim\n#   runtime must be >= the glibc zig links against (bookworm/slim is fine).\n#\n# Auto-generated by \`swelte deploy init --target ${target}\`. Re-run to refresh.\n\nFROM debian:stable-slim\nWORKDIR /app\nCOPY ${distDir} ./${distDir}\nEXPOSE 8131\nENV PORT=8131 SWELTE_DIST=${distDir}${ssr ? ' SWELTE_SSR=1' : ''}\nCMD ["./${distDir}/server"]\n`
}

export function renderDockerignore(dockerfile: string): string {
	return `# Slim prebuilt context: only dist/ + this Dockerfile ship.\n# Everything else (sources, node_modules, .swelte/, scripts) stays local.\n# Auto-generated by \`swelte deploy init\`. Re-run to refresh.\n*\n!dist\n!dist/**\n!${dockerfile}\n`
}

export function renderVercelignore(dockerfile: string): string {
	return `# Vercel upload context: \`dist/\` is gitignored but MUST upload —\n# allowlist it explicitly alongside the project files Vercel needs.\n# Everything else falls back to Vercel's defaults (node_modules etc.\n# excluded automatically).\n# Auto-generated by \`swelte deploy init --target vercel\`. Re-run to refresh.\n!dist\n!dist/**\n!${dockerfile}\n!package.json\n`
}

/** Minimal fly.toml: app name is a placeholder the user replaces on
 *  `fly launch` (which adopts/merges it); internals are the contract:
 *  build the generated Dockerfile, serve internal_port 8131, stop idle
 *  machines. The binary listens on $PORT (Fly sets it = internal_port). */
export function renderFlyToml(opts: { appName: string; dockerfile: string }): string {
	const { appName, dockerfile } = opts
	const buildSection =
		dockerfile === 'Dockerfile' ? '[build]' : `[build]\n  dockerfile = "${dockerfile}"`
	return `# Fly.io app config for ${appName} (Swelte prebuilt: dist/server + dist/).
# \`fly launch\` adopts this file (replace the placeholder name) or run
# \`fly deploy\` directly with an existing app.
# Auto-generated by \`swelte deploy init --target fly\`. Re-run to refresh.
app = "${appName}"
primary_region = "iad"

${buildSection}

[http_service]
  internal_port = 8131
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[env]
  SWELTE_DIST = "dist"
`
}

/** Minimal railway.json: Dockerfile builder + restart policy.
 *  (Railway auto-detects the Dockerfile; PORT is injected, healthchecks
 *  hit it. Set Root Directory + generate a public domain in the dashboard.) */
export function renderRailwayJson(opts: { dockerfile: string }): string {
	const { dockerfile } = opts
	return `// Railway service config (Swelte prebuilt: dist/server + dist/).
// Builder auto-detects the Dockerfile; PORT is injected by Railway.
// Dashboard: set Root Directory + generate a public domain (target = $PORT).
// Auto-generated by \`swelte deploy init --target railway\`. Re-run to refresh.
{
	"$schema": "https://railway.com/railway.schema.json",
	"build": {
		"builder": "DOCKERFILE",
		"dockerfilePath": "${dockerfile}"
	},
	"deploy": {
		"restartPolicyType": "ON_FAILURE",
		"restartPolicyMaxRetries": 3,
		"healthcheckPath": "/",
		"healthcheckTimeout": 30
	}
}
`
}

/** Minimal render.yaml Blueprint: one Docker web service.
 *  The Dockerfile builds in Render's cloud from the git context; the
 *  service listens on $PORT (Render injects it, default 10000). */
export function renderRenderYaml(opts: {
	appName: string
	dockerfile: string
	distDir: string
	ssr: boolean
}): string {
	const { appName, dockerfile, distDir, ssr } = opts
	const ssrVars = ssr ? '\n      - key: SWELTE_SSR\n        value: 1' : ''
	return `# Render Blueprint: one Docker web service for ${appName} (Swelte prebuilt).
# The Dockerfile builds in Render's cloud; the binary serves $PORT (injected).
# Auto-generated by \`swelte deploy init --target render\`. Re-run to refresh.
services:
  - type: web
    name: ${appName}
    runtime: docker
    plan: starter
    dockerfilePath: ./${dockerfile}
    healthCheckPath: /
    envVars:
      - key: SWELTE_DIST
        value: ${distDir}${ssrVars}
`
}

/** Target recipe replacing the `<!-- swelte:deploy -->` block in README.md.
 *  The region is delimited by open + close markers (standard managed-region
 *  pattern) so user prose before/after is never touched. */
export function renderDeployReadmeBlock(opts: {
	target: DeployTarget
	dockerfile: string
	appName: string
	rootRel: string | null
}): string {
	const { target, dockerfile, appName, rootRel } = opts
	const where =
		target === 'vercel'
			? rootRel
				? `Dashboard → project → Settings: Root Directory \`${rootRel}\`, Dockerfile Path \`${dockerfile}\`.`
				: `Dashboard → project → Settings: Dockerfile Path \`${dockerfile}\`.`
			: ''
	const buildLine = 'npm run build        # swelte build → linux/amd64 from package.json'
	const recipes: Record<Exclude<DeployTarget, 'static'>, string[]> = {
		vercel: [
			'```sh',
			buildLine,
			'vercel deploy            # preview URL',
			'vercel deploy --prod     # production',
			'```',
			'',
			`Vercel builds \`${dockerfile}\` in the cloud from the uploaded local \`dist/\``,
			`output — no toolchain in the cloud. ${where}`,
		],
		docker: [
			'```sh',
			buildLine,
			`docker build -t ${appName} . -f ${dockerfile}`,
			`docker run -e PORT=8131 -p 8131:8131 ${appName}`,
			'```',
		],
		fly: [
			'```sh',
			buildLine,
			'fly launch               # adopts fly.toml (replace the app name)',
			'fly deploy               # ship dist/ + dist/server',
			'```',
			'',
			'Fly builds the Dockerfile in its cloud from uploaded local `dist/`;',
			'the binary serves `$PORT` (= `internal_port` 8131).',
		],
		railway: [
			'```sh',
			buildLine,
			'railway up               # auto-detects the Dockerfile',
			'```',
			'',
			'Set Root Directory + generate a public domain in the dashboard',
			'(target = `$PORT`); `railway.json` pins the Dockerfile builder.',
		],
		render: [
			'```sh',
			buildLine,
			'git push                 # Render auto-deploys the Blueprint',
			'```',
			'',
			'Connect the repo once, Render builds the Dockerfile in its cloud;',
			'the binary serves `$PORT` (injected). `render.yaml` declares the service.',
		],
	}
	const lines = target === 'static' ? [] : recipes[target]
	return ['<!-- swelte:deploy -->', '', ...lines, '', '<!-- /swelte:deploy -->', ''].join('\n')
}

/** Patch README.md: replace the deploy block when the markers exist,
 *  append it when missing, create the file when absent. Returns the
 *  action taken. README has no drift state — only the marker-delimited
 *  region is managed; everything outside it is user-owned prose. */
export function patchReadme(
	readmePath: string,
	block: string,
	dryRun: boolean
): 'created' | 'updated' | 'unchanged' | 'skipped' {
	let prev: string | null = null
	try {
		prev = readFileSync(readmePath, 'utf8')
	} catch {
		prev = null
	}
	const open = '<!-- swelte:deploy -->'
	const close = '<!-- /swelte:deploy -->'
	if (prev === null) {
		if (!dryRun) writeFileSync(readmePath, `${block}`)
		return 'created'
	}
	const at = prev.indexOf(open)
	if (at < 0) {
		// No marker: append (never rewrite user prose).
		const next = `${prev.replace(/\n+$/, '\n')}\n## Deploy\n\n${block}`
		if (next === prev) return 'unchanged'
		if (!dryRun) writeFileSync(readmePath, next)
		return 'updated'
	}
	// Managed region: open marker through the close marker's line end.
	const closeAt = prev.indexOf(close, at)
	const end =
		closeAt < 0
			? prev.length // legacy single-marker file: whole tail is managed
			: prev.indexOf('\n', closeAt) + 1 || prev.length
	const next = `${prev.slice(0, at)}${block}${prev.slice(end)}`
	if (next === prev) return 'unchanged'
	if (!dryRun) writeFileSync(readmePath, next)
	return 'updated'
}

function writeIfDiff(path: string, next: string, dryRun: boolean, log: (m: string) => void): void {
	let prev: string | null = null
	try {
		prev = readFileSync(path, 'utf8')
	} catch {
		prev = null
	}
	if (prev === next) {
		log(`${basename(path)}: unchanged`)
		return
	}
	if (!dryRun) writeFileSync(path, next)
	log(`${basename(path)}: ${prev === null ? 'created' : 'updated'}${dryRun ? ' (dry-run)' : ''}`)
}

/** Repo-relative project path for the Root Directory hint (monorepos).
 *  Returns null for standalone projects (no workspace root above) — the
 *  hint is only meaningful when the project lives inside a monorepo. */
function relRoot(root: string): string | null {
	// Monorepo hint: path of `root` relative to the nearest ancestor holding
	// a workspace-root package.json. Standalone → null (hint omitted).
	const norm = (p: string): string => p.replace(/\\/g, '/')
	try {
		let dir = root
		for (let i = 0; i < 8; i++) {
			try {
				const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
					workspaces?: unknown
				}
				if (pkg.workspaces !== undefined && norm(dir) !== norm(root)) {
					const rel = relative(dir, root) || '.'
					if (rel !== '.' && !rel.startsWith('..')) return norm(rel)
				}
			} catch {
				/* not a package dir */
			}
			const parent = join(dir, '..')
			if (norm(parent) === norm(dir)) break
			dir = parent
		}
		return null
	} catch {
		return null
	}
}

export async function runDeploy(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const [subRaw, targetRaw] = ctx.rest
	const sub: DeploySub = subRaw === 'status' ? 'status' : 'init'
	const targetStr = String(
		(subRaw !== 'init' && subRaw !== 'status' && subRaw ? subRaw : '') ||
			targetRaw ||
			ctx.opts.target ||
			'vercel'
	).toLowerCase()
	if (!(SUPPORTED as string[]).includes(targetStr)) {
		throw new Error(`unsupported deploy target "${targetStr}" (expected: ${SUPPORTED.join(' | ')})`)
	}
	const target = targetStr as DeployTarget
	const { json: pkg } = readPkg(root)
	const ssr = hasSsrDep(pkg)
	const appName = typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : basename(root)
	let distDir = 'dist'
	try {
		const { loadConfig } = await import('../gen/config.js')
		const cfg = (await loadConfig(root)) as { distDir?: unknown }
		if (typeof cfg.distDir === 'string' && cfg.distDir.trim() !== '') distDir = cfg.distDir.trim()
	} catch {
		/* defaults */
	}
	const dockerfile = defaultDockerfile(target, ctx.opts.dockerfile)
	const format = String(ctx.opts.format ?? 'text')
	if (format !== 'text' && format !== 'json')
		throw new Error(`--format must be text or json (got ${format})`)
	const dryRun =
		ctx.opts['dry-run'] === true ||
		String(ctx.opts['dry-run'] ?? ctx.opts.dryRun ?? '').toLowerCase() === 'true'
	const force = ctx.opts.force === true || String(ctx.opts.force ?? '').toLowerCase() === 'true'
	const check = ctx.opts.check === true || String(ctx.opts.check ?? '').toLowerCase() === 'true'
	// `static` is packaging-only: no files, just assert the target shim.
	// Everything else is Dockerfile + ignores (+ one platform config).
	if (target === 'static') {
		if (sub === 'status' || check) {
			let shim = false
			try {
				shim = existsSync(join(root, distDir, '.swelte-static'))
			} catch {
				shim = false
			}
			ctx.log(`dist/.swelte-static: ${shim ? 'ok' : 'missing'}`)
			if (!shim) {
				throw new Error(
					'deploy status: drift detected (run `swelte build --target static` first, then `swelte deploy init --target static`)'
				)
			}
			ctx.log('deploy status: ok')
			return
		}
		if (!dryRun) {
			const { writeTargetShim } = await import('./build.js')
			mkdirSync(join(root, distDir), { recursive: true })
			writeTargetShim(root, distDir, 'static', {}, (m) => ctx.log(m))
		} else {
			ctx.log(`dist/.swelte-static: would write (dry-run)`)
		}
		ctx.log('next: deploy dist/ to any static host (CDN, GitHub Pages, S3)')
		return
	}
	const files: { rel: string; content: string }[] = [
		{
			rel: dockerfile,
			content: renderDockerfile({
				target,
				dockerfile,
				distDir,
				ssr,
				appName,
				rootRel: relRoot(root),
			}),
		},
		{ rel: '.dockerignore', content: renderDockerignore(dockerfile) },
	]
	if (target === 'vercel')
		files.push({ rel: '.vercelignore', content: renderVercelignore(dockerfile) })
	const cfgFile = targetConfigFile(target)
	if (cfgFile === 'fly.toml')
		files.push({ rel: cfgFile, content: renderFlyToml({ appName, dockerfile }) })
	else if (cfgFile === 'railway.json')
		files.push({ rel: cfgFile, content: renderRailwayJson({ dockerfile }) })
	else if (cfgFile === 'render.yaml')
		files.push({
			rel: cfgFile,
			content: renderRenderYaml({ appName, dockerfile, distDir, ssr }),
		})
	const driftOf = (): FileDrift[] =>
		files.map((f) => {
			const p = join(root, f.rel)
			if (!existsSync(p)) return { file: f.rel, state: 'missing' } as FileDrift
			try {
				const cur = readFileSync(p, 'utf8')
				return { file: f.rel, state: cur === f.content ? 'ok' : 'drift' } as FileDrift
			} catch {
				return { file: f.rel, state: 'drift' } as FileDrift
			}
		})
	const pkgStateOf = (): string => {
		const sw = (readPkg(root).json.swelte ?? {}) as Record<string, unknown>
		return sw.targetOs === 'linux' && sw.targetArch === 'amd64' ? 'ok' : 'drift'
	}
	if (sub === 'status' || check) {
		const drift = driftOf()
		const pkgState = pkgStateOf()
		if (format === 'json') {
			console.log(
				JSON.stringify({ target, dockerfile, files: drift, packageJson: pkgState }, null, 2)
			)
		} else {
			for (const d of drift) ctx.log(`${d.file}: ${d.state}`)
			ctx.log(`package.json swelte.targetOs/targetArch: ${pkgState}`)
		}
		if (drift.some((d) => d.state !== 'ok') || pkgState !== 'ok') {
			throw new Error(
				`deploy status: drift detected (run \`swelte deploy init --target ${target}\`)`
			)
		}
		ctx.log('deploy status: ok')
		return
	}
	if (!dryRun) mkdirSync(root, { recursive: true })
	for (const f of files) writeIfDiff(join(root, f.rel), f.content, dryRun, ctx.log)
	// README deploy block: replace managed block, append under `## Deploy`
	// when unmarked, create when absent. User prose elsewhere untouched.
	const readmeBlock = renderDeployReadmeBlock({
		target,
		dockerfile,
		appName,
		rootRel: relRoot(root),
	})
	const readmeAction = patchReadme(join(root, 'README.md'), readmeBlock, dryRun)
	ctx.log(`README.md: ${readmeAction}${dryRun ? ' (dry-run)' : ''}`)
	const pkgPath = join(root, 'package.json')
	const { raw, json: pkg2 } = readPkg(root)
	if (raw === null) {
		ctx.log('no package.json — skipping targetOs/targetArch patch')
		return
	}
	const sw = (pkg2.swelte ?? {}) as Record<string, unknown>
	const needOs = sw.targetOs !== 'linux'
	const needArch = sw.targetArch !== 'amd64'
	if (!needOs && !needArch) {
		ctx.log('package.json: swelte.targetOs/targetArch already linux/amd64')
	} else if (dryRun) {
		ctx.log('package.json: would set swelte.targetOs/targetArch → linux/amd64 (dry-run)')
	} else {
		if (needOs) {
			if (sw.targetOs === undefined || force) sw.targetOs = 'linux'
			else ctx.error('package.json swelte.targetOs is not "linux" — pass --force to overwrite')
		}
		if (needArch) {
			if (sw.targetArch === undefined || force) sw.targetArch = 'amd64'
			else ctx.error('package.json swelte.targetArch is not "amd64" — pass --force to overwrite')
		}
		pkg2.swelte = sw
		writeFileSync(pkgPath, `${JSON.stringify(pkg2, null, 2)}\n`)
		ctx.log('package.json: swelte.targetOs/targetArch → linux/amd64')
	}
	if (target === 'vercel')
		ctx.log('next: npm run build && vercel deploy (preview) / vercel deploy --prod')
	else ctx.log(`next: npm run build && ${targetShipCommand(target, appName, dockerfile)}`)
}
