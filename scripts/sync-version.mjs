#!/usr/bin/env node
// Single version truth: root package.json#version.
// Usage: node scripts/sync-version.mjs [0.1.2 | patch | minor | major]
//   - explicit version: sets root + engine/*/package.json to it
//   - patch|minor|major: bumps root version accordingly
//   - no arg: syncs engine/* to current root version
// Syncs: engine/*/package.json#version + all @swelte/* ^ranges in engine/*,
// plus examples/*/package.json#version + @swelte/* ^ranges + shared pins
// (svelte/vite/vite-plugin-svelte/typescript/@types/node aligned on core).
// Never touches: root private flag, templates/* placeholders
// (__NAME__, __SWELTE_VERSION__ stay literal) — only their shared pins.
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'package.json'
const PACKAGES = ['engine/core', 'engine/vvm', 'engine/ssr-qjs', 'engine/mcp', 'engine/plus']
const EXAMPLES = ['examples/tests', 'examples/something', 'examples/docs-site']
const TEMPLATE = 'engine/core/templates/base'
// Shared pins aligned on core (single truth for the whole repo).
const PIN_KEYS = ['svelte', 'vite', '@sveltejs/vite-plugin-svelte', 'typescript', '@types/node']

function bump(v, kind) {
	const [maj, min, pat] = v.split('.').map(Number)
	if (kind === 'major') return `${maj + 1}.0.0`
	if (kind === 'minor') return `${maj}.${min + 1}.0`
	return `${maj}.${min}.${pat + 1}`
}

const arg = process.argv[2]
const root = JSON.parse(readFileSync(ROOT, 'utf8'))
let next = root.version
if (arg) {
	if (/^\d+\.\d+\.\d+/.test(arg)) next = arg.replace(/^v/, '').split('-')[0] + (arg.includes('-') ? '-' + arg.split('-').slice(1).join('-') : '')
	else if (['patch', 'minor', 'major'].includes(arg)) next = bump(next, arg)
	else {
		console.error(`sync-version: want explicit x.y.z or patch|minor|major (got ${arg})`)
		process.exit(1)
	}
	root.version = next
	writeFileSync(ROOT, JSON.stringify(root, null, 2) + '\n')
	console.log(`root: ${next}`)
}

for (const p of PACKAGES) {
	const f = `${p}/package.json`
	const pj = JSON.parse(readFileSync(f, 'utf8'))
	pj.version = next
	for (const k of ['dependencies', 'peerDependencies', 'devDependencies']) {
		for (const d in pj[k] ?? {}) {
			if (d.startsWith('@swelte/')) pj[k][d] = `^${next}`
		}
	}
	writeFileSync(f, JSON.stringify(pj, null, 2) + '\n')
	console.log(`${p}: ${next}`)
}

// Shared pins: read the truth off @swelte/core once engines are synced.
const core = JSON.parse(readFileSync('engine/core/package.json', 'utf8'))
const pins = {}
for (const k of ['dependencies', 'peerDependencies', 'devDependencies']) {
	for (const d in core[k] ?? {}) {
		if (PIN_KEYS.includes(d)) pins[d] ??= core[k][d]
	}
}

for (const p of EXAMPLES) {
	const f = `${p}/package.json`
	const pj = JSON.parse(readFileSync(f, 'utf8'))
	if (pj.private) pj.version = next
	for (const k of ['dependencies', 'peerDependencies', 'devDependencies']) {
		for (const d in pj[k] ?? {}) {
			if (d.startsWith('@swelte/')) pj[k][d] = `^${next}`
			else if (d in pins) pj[k][d] = pins[d]
		}
	}
	writeFileSync(f, JSON.stringify(pj, null, 2) + '\n')
	console.log(`${p}: ${next}`)
}

// Scaffold template: placeholders stay literal, shared pins still align.
{
	const f = `${TEMPLATE}/package.json`
	const pj = JSON.parse(readFileSync(f, 'utf8'))
	for (const k of ['dependencies', 'peerDependencies', 'devDependencies']) {
		for (const d in pj[k] ?? {}) {
			if (d.startsWith('@swelte/')) continue // ^__SWELTE_VERSION__ (init replaces)
			if (d in pins) pj[k][d] = pins[d]
		}
	}
	writeFileSync(f, JSON.stringify(pj, null, 2) + '\n')
	console.log(`${TEMPLATE}: pins`)
}
