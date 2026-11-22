// Version tooling for the shared-line / independent-patch policy
// (docs/specs/versioning.md).
//
// Active release line: 0.2 — participants core, vvm, ssr-qjs, mcp, ai, create, plus
// share major.minor, each owns its patch counter.
//
// Usage:
//   node scripts/sync-version.mjs                  sync ranges/pins to per-package versions
//   node scripts/sync-version.mjs patch <pkg>      bump one package patch (e.g. patch core)
//   node scripts/sync-version.mjs line-cut <0.x>   coordinated minor cut: active participants -> <0.x>.0
//   node scripts/sync-version.mjs plan [--json]    dry-run: which tarballs git status selects
//   node scripts/sync-version.mjs check [--json] [--mode single|line-cut] [--packages "core ..."]
//                                                  registry gate: diff workspace vs npm published versions.
//                                                  single (default): patch-only — line changes are refused.
//                                                  line-cut: coordinated cut — all active must share the new line.
//
// Publish selection: publish the packages whose artifacts or declared
// compatibility changed — derived from git status, reviewed via `plan`.
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'package.json'
// Line participants: every active package on the shared major.minor line
// (plus is an active 0.2 participant — jobs + db plugins).
const ACTIVE = ['core', 'vvm', 'ssr-qjs', 'mcp', 'ai', 'create', 'plus']
const ALL_DIRS = ['engine/core', 'engine/vvm', 'engine/ssr-qjs', 'engine/mcp', 'engine/ai', 'engine/create', 'engine/plus']
const EXAMPLES = ['examples/tests', 'examples/something', 'examples/docs-site']
const TEMPLATE = 'engine/create/templates/base'
// Shared pins aligned on core (single truth for the whole repo).
const PIN_KEYS = ['svelte', 'vite', '@sveltejs/vite-plugin-svelte', 'typescript', '@types/node']
const templatePackages = ['core', 'ssr-qjs', 'vvm']
const sections = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']

function readJson(path, changes) {
	return changes?.get(path) ?? JSON.parse(readFileSync(path, 'utf8'))
}

function commit(changes) {
	for (const [path, manifest] of changes) {
		const text = JSON.stringify(manifest, null, 2) + '\n'
		if (readFileSync(path, 'utf8') !== text) writeFileSync(path, text)
	}
}

// Ordinary sync leaves reviewed internal floors alone. A new line starts at patch zero.
function syncAll(changes, targetLine) {
	const core = readJson('engine/core/package.json', changes)
	const pins = Object.assign({}, core.devDependencies, core.peerDependencies, core.dependencies)
	for (const dir of [...ALL_DIRS, ...EXAMPLES]) {
		const path = dir + '/package.json'
		const manifest = readJson(path, changes)
		if (targetLine) {
			for (const section of sections) {
				for (const dep of ACTIVE) {
					const name = '@swelte/' + dep
					if (manifest[section]?.[name]) manifest[section][name] = '^' + targetLine + '.0'
				}
			}
			if (ACTIVE.some((pkg) => dir === 'engine/' + pkg)) manifest.version = targetLine + '.0'
			if (dir === 'engine/create') {
				for (const dep of templatePackages) manifest.templateMinimums['@swelte/' + dep] = targetLine + '.0'
			}
		}
		changes.set(path, manifest)
	}
	for (const dir of [...EXAMPLES, TEMPLATE]) {
		const path = dir + '/package.json'
		const manifest = readJson(path, changes)
		for (const section of sections) {
			for (const dep of PIN_KEYS) {
				if (manifest[section]?.[dep] && pins[dep]) manifest[section][dep] = pins[dep]
			}
		}
		changes.set(path, manifest)
	}
}

function bump(v) {
	const [maj, min, pat] = v.split('.').map(Number)
	return `${maj}.${min}.${pat + 1}`
}

function changedFiles() {
	try {
		return execSync('git status --porcelain', { encoding: 'utf8' })
	} catch {
		return ''
	}
}

// Publish plan: which tarballs would a publish select?
// - single-package patch: files under exactly one engine/<pkg> -> 1 tarball
// - docs-only (no engine/* changes): 0
// - coordinated line cut: every active participant exactly once
function plan({ json = false } = {}) {
	const status = changedFiles()
		.split('\n')
		.map((l) => l.slice(3).trim())
		.filter(Boolean)
	const touched = new Set()
	for (const f of status) {
		const m = f.match(/^engine\/([^/]+)\//)
		if (m && ACTIVE.includes(m[1])) touched.add(m[1])
	}
	const selection = [...touched]
	if (!json) {
		if (selection.length === 0) {
			console.log('plan: no publish (docs-only or no engine changes)')
		} else {
			console.log(`plan: publish ${selection.length} tarball(s): ${selection.join(', ')}`)
			console.log(`order: ${['vvm', 'core', 'plus', 'ai', 'mcp', 'ssr-qjs', 'create'].filter((p) => touched.has(p)).join(' -> ')}`)
		}
	} else {
		console.log(JSON.stringify({ selection, status }))
	}
	return selection
}

const [cmd, ...rest] = process.argv.slice(2)
const arg = rest[0]

// Registry gate: diff workspace versions against npm published versions.
// - same version: already published -> skip (no-op, never republish)
// - same line, workspace patch ahead: independent patch -> publish (both modes)
// - line change (major.minor differs): single mode REFUSES (fail-fast);
//   line-cut mode allows it, but only when every active participant shares
//   the new line (e.g. 0.1.x -> 0.2.0 for all)
// - workspace behind published: stale -> refuse (both modes)
// - E404 (never published): allow (first release)
// - registry unreachable: fail closed (never publish blind)
function parseVer(v) {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim())
	return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null
}
function lineOf(v) {
	const p = parseVer(v)
	return p ? `${p.major}.${p.minor}` : null
}
function cmpVer(a, b) {
	const pa = parseVer(a)
	const pb = parseVer(b)
	if (!pa || !pb) return null
	for (const k of ['major', 'minor', 'patch']) {
		if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1
	}
	return 0
}

function registryVersion(spec) {
	try {
		const version = execFileSync('npm', ['view', spec, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
		if (version && parseVer(version)) return { version }
		return { error: 'Invalid registry response for ' + spec }
	} catch (e) {
		const message = String(e.stderr || e.message).trim()
		if (/\bcode E404\b/i.test(message)) return { missing: true }
		return { error: message || 'Registry lookup failed for ' + spec }
	}
}

function decide(row, mode, publish, skipped, refused) {
	const { pkg, local, published } = row
	if (row.missing) return publish.push(pkg)
	const order = cmpVer(local, published)
	if (order === null) refused.push({ pkg, reason: 'unparseable version' })
	else if (order < 0) refused.push({ pkg, reason: `stale: workspace ${local} behind published ${published}` })
	else if (row.exists) skipped.push({ pkg, reason: 'already published @ ' + local })
	else if (mode === 'single' && lineOf(local) !== lineOf(published)) {
		refused.push({ pkg, reason: `line change ${published} -> ${local}: rerun with --mode line-cut` })
	} else publish.push(pkg)
}

function checkCommand(args) {
	const json = args.includes('--json')
	const modeIdx = args.indexOf('--mode')
	const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'single'
	const pkgIdx = args.indexOf('--packages')
	const wantRaw = pkgIdx >= 0 ? (args[pkgIdx + 1] ?? '') : ''
	if (!['single', 'line-cut'].includes(mode)) {
		console.error(`check: want --mode single|line-cut (got ${mode})`)
		process.exit(1)
	}
	// Explicit allow-list: unknown names are refused, never published.
	const unknown = []
	const selected = []
	for (const p of wantRaw.split(/\s+/).filter(Boolean)) {
		if (ACTIVE.includes(p)) selected.push(p)
		else unknown.push(p)
	}
	const targets = wantRaw ? selected : [...ACTIVE]
	// Dependency order so ^ranges resolve to the just-published version.
	const ORDER = ['vvm', 'core', 'plus', 'ai', 'mcp', 'ssr-qjs', 'create']
	targets.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
	const rows = targets.map((p) => {
		const local = readJson(`engine/${p}/package.json`).version
		const spec = '@swelte/' + p
		const pub = registryVersion(spec)
		const exact = pub.version && cmpVer(local, pub.version) > 0 ? registryVersion(spec + '@' + local) : pub
		return {
			pkg: p, local, published: pub.version ?? null, missing: !!pub.missing,
			error: pub.error ?? exact.error ?? null, exists: exact.version === local,
		}
	})
	const registryError = rows.some((r) => r.error)
	const publish = []
	const skipped = []
	const refused = [...unknown.map((p) => ({ pkg: p, reason: 'unknown package' }))]
	const line = lineOf(readJson(ROOT).version)
	for (const reason of validateRelease(line)) refused.push({ pkg: 'workspace', reason })
	if (mode === 'line-cut' && !ACTIVE.every((pkg) => targets.includes(pkg))) {
		refused.push({ pkg: 'workspace', reason: 'line-cut needs every active participant' })
	}
	if (!registryError && !refused.length) {
		for (const row of rows) decide(row, mode, publish, skipped, refused)
	}
	if (refused.length) publish.length = 0
	const result = { mode, publish, skipped, refused, rows, registryError }
	if (json) console.log(JSON.stringify(result, null, 2))
	else {
		for (const r of rows) {
			const hit = (list) => list.find((x) => x.pkg === r.pkg)
			const verdict = r.error
				? `ERROR (${r.error})`
				: publish.includes(r.pkg)
					? `PUBLISH (local ${r.local} > published ${r.published ?? 'none (first release)'})`
					: hit(skipped)
						? `skip — ${hit(skipped).reason}`
						: `REFUSED — ${hit(refused)?.reason ?? 'missing from registry diff'}`
			console.log(`check [${mode}]: @swelte/${r.pkg}: ${verdict}`)
		}
		for (const r of refused) {
			if (!rows.some((x) => x.pkg === r.pkg)) console.log(`check [${mode}]: @swelte/${r.pkg}: REFUSED — ${r.reason}`)
		}
		if (registryError) console.log('check: registry unreachable — fail closed, publish nothing')
		else if (publish.length) console.log(`check: publish ${publish.length}: ${publish.join(' -> ')}`)
		else console.log('check: nothing to publish')
	}
	if (registryError || refused.length || (!publish.length && !skipped.length)) process.exit(1)
}

function validateRelease(line, changes) {
	const problems = []
	for (const pkg of ACTIVE) {
		const manifest = readJson(`engine/${pkg}/package.json`, changes)
		if (lineOf(manifest.version) !== line) problems.push(pkg + ' is outside release line ' + line)
		for (const section of sections) {
			for (const dep of ACTIVE) {
				const range = manifest[section]?.['@swelte/' + dep]
				if (range && (!range.startsWith('^') || lineOf(range.slice(1)) !== line)) {
					problems.push(`${pkg}: @swelte/${dep} range ${range} is outside ${line}`)
				}
			}
		}
	}
	const create = readJson('engine/create/package.json', changes)
	const template = readJson(TEMPLATE + '/package.json', changes)
	for (const dep of templatePackages) {
		const name = '@swelte/' + dep
		const minimum = create.templateMinimums?.[name]
		const available = readJson(`engine/${dep}/package.json`, changes).version
		if (typeof minimum !== 'string' || lineOf(minimum) !== line || cmpVer(minimum, available) > 0) {
			problems.push('Invalid scaffold minimum for ' + name)
		}
	}
	for (const [section, dep] of [['dependencies', 'core'], ['devDependencies', 'vvm']]) {
		if (template[section]?.['@swelte/' + dep] !== '^__SWELTE_VERSION_' + dep + '__') {
			problems.push('Invalid template placeholder for ' + dep)
		}
	}
	// Browser-safe version constants in published src/lib (SSR/client bundles
	// forbid node: imports, so these duplicate package.json — gate the sync
	// when the source file is present (release fixtures copy manifests only).
	try {
		const aiVersion = readJson('engine/ai/package.json', changes).version
		const aiConst = readFileSync('engine/ai/src/lib/version.ts', 'utf8')
		if (!aiConst.includes(`'${aiVersion}'`)) problems.push('engine/ai VERSION constant out of sync with package.json')
	} catch (e) {
		if (e?.code !== 'ENOENT') problems.push('engine/ai version constant unreadable')
	}
	return problems
}

if (!cmd || cmd === 'patch' || cmd === 'line-cut') {
	const changes = new Map()
	const root = readJson(ROOT)
	let line = lineOf(root.version)
	let targetLine
	if (cmd === 'patch') {
		if (!ACTIVE.includes(arg)) throw new Error('Unknown package: ' + arg)
		const path = `engine/${arg}/package.json`
		const manifest = readJson(path)
		manifest.version = bump(manifest.version)
		changes.set(path, manifest)
	} else if (cmd === 'line-cut') {
		if (!/^\d+\.\d+$/.test(arg) || cmpVer(arg + '.0', line + '.0') < 0) throw new Error('Invalid target line: ' + arg)
		if (line !== arg) {
			line = targetLine = arg
			root.version = line + '.0'
			changes.set(ROOT, root)
		}
	}
	syncAll(changes, targetLine)
	const errors = validateRelease(line, changes)
	if (errors.length) throw new Error(errors.join('\n'))
	commit(changes)
} else if (cmd === 'plan') {
	plan({ json: arg === '--json' })
} else if (cmd === 'check') {
	checkCommand(rest)
} else if (['minor', 'major'].includes(cmd) || /^\d+\.\d+\.\d+/.test(cmd)) {
	console.error(
		`sync-version: lockstep bumps removed (see docs/specs/versioning.md). Use 'patch <pkg>' or 'line-cut <major.minor>'.`,
	)
	process.exit(1)
} else {
	console.error(`sync-version: unknown command ${cmd} (want: patch <pkg> | line-cut <0.x> | plan | check | <no arg> sync)`)
	process.exit(1)
}
