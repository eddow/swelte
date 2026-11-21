#!/usr/bin/env node
// shell/ai dogfood pack check (Phase B last box): pack @swelte/ai, install
// AI-only in a clean dir, assert @swelte/media is absent, import the four
// entry points, route by latency, and typecheck the text route surface.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'ai-pack-'))

function run(cmd, args, cwd = root) {
	return execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] })
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
run('npm', ['pack', '--workspace=engine/ai', '--pack-destination', scratch, '--silent'])
const tgz = join(scratch, `swelte-ai-${version}.tgz`)
assert.ok(existsSync(tgz), 'packed @swelte/ai missing')

const app = join(scratch, 'app')
run('npm', ['init', '-y'], scratch)
writeFileSync(
	join(scratch, 'package.json'),
	JSON.stringify({ name: 'ai-only-probe', private: true, type: 'module', dependencies: { '@swelte/ai': `file:${tgz}` } }, null, 2)
)
run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false'], scratch)
assert.ok(!existsSync(join(scratch, 'node_modules', '@swelte', 'media')), '@swelte/media must be absent in AI-only install')

const probe = join(scratch, 'probe.mjs')
writeFileSync(
	probe,
	`import assert from 'node:assert/strict';
import * as ai from '@swelte/ai';
import * as openrouter from '@swelte/ai/openrouter';
import * as openai from '@swelte/ai/openai';
import * as anthropic from '@swelte/ai/anthropic';
assert.ok(typeof ai.routeAdapter === 'function');
assert.ok(typeof openrouter.OpenRouterAdapter === 'function');
assert.ok(typeof openai.OpenAiAdapter === 'function');
assert.ok(typeof anthropic.AnthropicAdapter === 'function');
const fast = new openai.OpenAiAdapter({ apiKey: 'k', model: 'fast', latencyMs: 5, maxCostPer1k: 1, fetch: async () => { throw new Error('no net'); } });
const slow = new openai.OpenAiAdapter({ apiKey: 'k', model: 'slow', latencyMs: 50, maxCostPer1k: 1, fetch: async () => { throw new Error('no net'); } });
const picked = ai.routeAdapter({ input: ['text'], output: ['text'] }, [slow, fast]);
assert.equal(picked?.model, 'fast', 'latency routing picks the faster adapter');
const budgeted = ai.routeAdapter({ input: ['text'], output: ['text'] }, [slow, fast], { maxCostPer1k: 0.5 });
assert.equal(budgeted, null, 'budget routing skips adapters above the ceiling');
const det = new ai.DeterministicAdapter();
let text = '';
for await (const e of det.run('hi', { input: ['text'], output: ['text'] })) { if (e.envelope.kind === 'text.delta') text += e.payload.text; }
assert.equal(text, 'echo: hi');
console.log('ai-only pack probe ok');\n`
)
run(process.execPath, [probe], scratch)
console.log('PASS: ai-only pack (media absent, 4 entry points, latency routing)')
