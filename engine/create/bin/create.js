#!/usr/bin/env node
// Shim: the real scaffolder lives in ../dist/index.js (TS, tsc-ed). This file
// must run before anything is built, so it stays dependency-free.
import('../dist/index.js').then((m) => m.main()).catch((e) => {
  console.error(`create-@swelte: ${e?.message ?? e}`);
  process.exitCode = 1;
});
