import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { bridgeSrc, buildQjsProd, whichCC } from './qjs.js'

describe('item 25 — QJS prod link (gcc-gated)', () => {
	const cc = whichCC()
	const gate = cc ? it : (it.skip ?? it)

	gate('libqjs.a built once (mtime guard skips rebuild), bridge + flags shape', async (_t) => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-qjs-'))
		const out1 = buildQjsProd({ root, renderJs: join(root, 'dist', 'ssr', 'render.js') })
		assert.ok(existsSync(out1.lib))
		assert.ok(existsSync(out1.bridge))
		assert.ok(out1.bridge.endsWith(join('.swelte', 'routes', 'swelte_qjs_bridge.v')))
		assert.ok(out1.flags.includes('-lqjs -lm'))
		assert.ok(out1.qjscNote.length > 0)
		const mt1 = statSync(out1.lib).mtimeMs
		// Second build with no source change: archive untouched.
		await new Promise((r) => setTimeout(r, 20))
		const out2 = buildQjsProd({ root, renderJs: join(root, 'dist', 'ssr', 'render.js') })
		assert.equal(out2.lib, out1.lib)
		assert.equal(statSync(out2.lib).mtimeMs, mt1)
		// Execute the C boundary itself: limits must fail predictably, and a
		// concurrently rotating bytecode cache must never swap bundle output.
		const source = join(root, 'probe.c')
		writeFileSync(
			source,
			`
#include "swelte_qjs.h"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

static int render(const char *source, int timeout, int memory) {
    int handle = swelte_qjs_new_runtime();
    assert(handle);
    char head[64], body[256];
    int nh = 0, nb = 0;
    int rc = swelte_qjs_render_head_body(handle, source, strlen(source), "/", 1, "{}", 2,
        head, sizeof(head), &nh, body, sizeof(body), &nb, timeout, memory);
    swelte_qjs_free_runtime(handle);
    return rc;
}

static void *rotate(void *arg) {
    long index = (long)arg;
    char source[256], expected[32];
    snprintf(expected, sizeof(expected), "bundle-%ld", index);
    snprintf(source, sizeof(source), "export function renderRoute(){return {head:'',body:'%s'}}", expected);
    for (int n = 0; n < 60; n++) {
        int handle = swelte_qjs_new_runtime();
        assert(handle);
        char body[64];
        int rc = swelte_qjs_render(handle, source, strlen(source), "/", 1, "{}", 2,
            body, sizeof(body), 1000, 16);
        assert(rc == (int)strlen(expected));
        assert(strcmp(body, expected) == 0);
        swelte_qjs_free_runtime(handle);
    }
    return NULL;
}

static void diagnostics(void) {
    int handle = swelte_qjs_new_runtime();
    assert(handle);
    char head[64], body[256];
    struct { char text[32]; char guard; } detail;
    detail.guard = 42;
    memset(detail.text, 'X', sizeof(detail.text));
    int nh = 0, nb = 0;
    const char *source = "export function renderRoute(){throw Error('private cause with a deliberately long detail')}";
    int rc = swelte_qjs_render_report(handle, source, strlen(source), "/", 1, "{}", 2,
        head, sizeof(head), &nh, body, sizeof(body), &nb, 1000, 16,
        detail.text, sizeof(detail.text));
    assert(rc == -1);
    assert(strstr(detail.text, "private cause"));
    assert(detail.text[31] == 0 && detail.guard == 42);
    source = "export function renderRoute(){globalThis.__swelteSsrPage={renderError:'caught private cause'};return {head:'',body:'safe'}}";
    rc = swelte_qjs_render_report(handle, source, strlen(source), "/", 1, "{}", 2,
        head, sizeof(head), &nh, body, sizeof(body), &nb, 1000, 16,
        detail.text, sizeof(detail.text));
    assert(rc == 0 && strcmp(body, "safe") == 0);
    assert(strcmp(detail.text, "caught private cause") == 0);
    source = "export function renderRoute(){return {head:'',body:'ok'}}";
    rc = swelte_qjs_render_report(handle, source, strlen(source), "/", 1, "{}", 2,
        head, sizeof(head), &nh, body, sizeof(body), &nb, 1000, 16,
        detail.text, sizeof(detail.text));
    assert(rc == 0 && detail.text[0] == 0 && detail.guard == 42);
    swelte_qjs_free_runtime(handle);
}

int main(void) {
    diagnostics();
    assert(render("export function renderRoute(){return {head:'',body:'ok'}}", 1000, 16) == 0);
    assert(render("export function renderRoute(){throw Error('private detail')}", 1000, 16) == -1);
    assert(render("export function renderRoute(){while(true){}}", 10, 16) == -5);
    int oom = render("export function renderRoute(){let a=[];while(true)a.push(new Array(10000).fill(1))}", 2000, 8);
    assert(oom == -6);
    assert(render("invalid JavaScript !", 1000, 16) == -3);
    pthread_t threads[8];
    for (long n = 0; n < 8; n++) assert(!pthread_create(&threads[n], NULL, rotate, (void *)n));
    for (int n = 0; n < 8; n++) assert(!pthread_join(threads[n], NULL));
    puts("native QJS limits and concurrent bundle isolation passed");
}
`
		)
		const executable = join(root, 'probe')
		const cDir = fileURLToPath(new URL('../c/', import.meta.url))
		const env = {
			...process.env,
			PATH: process.env.PATH?.split(delimiter)
				.filter((path) => !/conda|mamba/i.test(path))
				.join(delimiter),
		}
		execFileSync(
			cc!,
			['-I', cDir, source, out1.lib, '-lm', '-lpthread', '-ldl', '-o', executable],
			{ timeout: 30_000, env }
		)
		assert.match(
			execFileSync(executable, [], { encoding: 'utf8', timeout: 30_000 }),
			/native QJS limits/
		)
		rmSync(root, { recursive: true, force: true })
	})

	it('bridgeSrc interpolates timeout/mem constants, no template holes', () => {
		// Pure-shape half: runs even without a compiler.
		const src = bridgeSrc('/lib/libqjs.a', '/c/dir', 50, 16)
		assert.ok(src.includes('return 50'))
		assert.ok(src.includes('u32(16)'))
		assert.ok(src.includes('swelte_qjs.h'))
		assert.ok(!src.includes('${timeoutMs}') && !src.includes('${memoryMB}'))
	})
})
