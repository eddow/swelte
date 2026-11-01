#!/usr/bin/env node
// Shim: the real server lives in ../dist/cli.js (TS, tsc-ed). This file must
// run before anything is built, so it stays dependency-free.
import('../dist/cli.js').then((cli) => cli.main()).catch((e) => {
  console.error(`swelte-mcp: ${e?.message ?? e}`);
  process.exitCode = 1;
});
