#!/usr/bin/env node
// Shim: the real CLI lives in ../dist/cli.js (TS, tsc-ed). This file must
// run before anything is built, so it stays dependency-free.
import('../dist/cli.js').then(async (cli) => {
	const [cmd, ...rest] = process.argv.slice(2);
	const opts = {};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (!a.startsWith('--')) continue;
		const key = a.slice(2);
		const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : '1';
		opts[key] = val;
	}
	const root = opts.root ?? process.cwd();
	const num = (v) => (v === undefined || v === '1' ? undefined : Number(v));
	try {
		if (!cmd || cmd === '--help' || cmd === '-h') {
			console.log('usage: swelte-ssr <dev|check> [--root DIR] [--port N] [--backend N] [--ssr-port N]');
			return;
		}
		if (cmd === 'check') {
			await cli.runSsrCheck({
				root,
				port: num(opts.port),
				outDir: opts['out-dir'],
				throwRoute: opts['throw-route'],
			});
			return;
		}
		if (cmd === 'dev') {
			await cli.runSsrDev({
				root,
				port: num(opts.port),
				backend: num(opts.backend),
				ssrPort: num(opts['ssr-port']),
				outDir: opts['out-dir'],
			});
			return;
		}
		console.error(`swelte-ssr: unknown command "${cmd}".`);
		console.error('usage: swelte-ssr <dev|check> [--root DIR] [--port N] [--backend N] [--ssr-port N]');
		process.exitCode = 1;
	} catch (e) {
		console.error(`swelte-ssr: ${e?.message ?? e}`);
		process.exitCode = 1;
	}
}).catch((e) => {
	console.error(`swelte-ssr: ${e?.message ?? e}`);
	process.exitCode = 1;
});
