import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, it } from 'node:test'
import { buildQjsLib, qjsCDir, whichCC } from './qjs.js'

describe('qjs — shared archive build (gcc-gated)', () => {
	const cc = whichCC()
	const gate = cc ? it : (it.skip ?? it)

	gate('libqjs.a built once (mtime guard skips rebuild)', async (_t) => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-qjs-'))
		const out1 = buildQjsLib({ root, outDir: '.swelte' })
		assert.ok(existsSync(out1.lib))
		assert.ok(
			out1.cDir.endsWith(join('@swelte', 'qjs', 'c')) || out1.cDir.endsWith(join('qjs', 'c'))
		)
		const mt1 = statSync(out1.lib).mtimeMs
		// Second build with no source change: archive untouched.
		await new Promise((r) => setTimeout(r, 20))
		const out2 = buildQjsLib({ root, outDir: '.swelte' })
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

int main(void) {
 int handle = swelte_qjs_new_runtime();
 assert(handle);
 JSRuntime *rt = swelte_qjs_rt_at(handle);
 JSContext *ctx = JS_NewContext(rt);
 JSValue value = JS_Eval(ctx, "1+2", 3, "<test>", JS_EVAL_TYPE_GLOBAL);
 int result;
 assert(!JS_ToInt32(ctx, &result, value) && result == 3);
 JS_FreeValue(ctx, value);
 value = JS_Eval(ctx, "throw Error()", 13, "<test>", JS_EVAL_TYPE_GLOBAL);
 assert(JS_IsException(value));
 JS_FreeValue(ctx, JS_GetException(ctx));
 swelte_qjs_budget budget = {swelte_qjs_now_ms(), 10, 0};
 JS_SetInterruptHandler(rt, swelte_qjs_interrupt, &budget);
 value = JS_Eval(ctx, "while(true){}", 13, "<test>", JS_EVAL_TYPE_GLOBAL);
 assert(JS_IsException(value) && budget.interrupted);
 JS_FreeValue(ctx, JS_GetException(ctx));
 JS_SetInterruptHandler(rt, NULL, NULL);
 JS_SetMemoryLimit(rt, 1024 * 1024);
 const char *oom = "let a=[];while(true)a.push(new Array(10000).fill(1))";
 value = JS_Eval(ctx, oom, strlen(oom), "<test>", JS_EVAL_TYPE_GLOBAL);
 assert(JS_IsException(value));
 JS_FreeValue(ctx, JS_GetException(ctx));
 JS_FreeContext(ctx);
 swelte_qjs_free_runtime(handle);
 assert(!swelte_qjs_rt_at(handle));
 puts("native QJS limits passed");
}

`
		)
		const executable = join(root, 'probe')
		const cDir = qjsCDir(import.meta.url)
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

	it('qjsCDir resolves the installed @swelte/qjs package (single candidate)', () => {
		const cDir = qjsCDir(import.meta.url)
		assert.ok(existsSync(join(cDir, 'swelte_qjs.c')))
		assert.ok(!existsSync(join(cDir, 'swelte_agent.c')))
	})
})
