#!/usr/bin/env node
// vvm — V Version Manager (nvm for V).
// Installs V toolchains into <vvm>/versions/<version>/ and exposes the
// active one via node_modules/.bin/v (npm bin-link to bin/v-shim.js).
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

export const VVM_VERSION = '0.1.0';
export const DEFAULT_V_VERSION = '0.5.2';

const HERE = dirname(fileURLToPath(import.meta.url));
// NOTE: in an npm/pnpm workspace this package is symlinked into node_modules,
// so import.meta.url resolves to the real source dir (engine/vvm). When
// installed from the registry it resolves to node_modules/@swelte/vvm.
// VVM_ROOT env overrides both (also honoured by bin/v-shim.js).
export const VVM_ROOT = process.env.VVM_ROOT ? resolve(process.env.VVM_ROOT) : resolve(HERE, '..');

const ASSETS = {
  'linux-x64': 'v_linux.zip',
  'linux-arm64': 'v_linux_arm64.zip',
  'darwin-arm64': 'v_macos_arm64.zip',
  'darwin-x64': 'v_macos_x86_64.zip',
  'win32-x64': 'v_windows.zip'
};

export function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const key = `${process.platform}-${arch}`;
  if (ASSETS[key]) return key;
  if (process.platform === 'win32') return 'win32-x64';
  return key;
}

export function versionsDir(root = VVM_ROOT) {
  return join(root, 'versions');
}

export function versionDir(version, root = VVM_ROOT) {
  return join(versionsDir(root), `v${version.replace(/^v/, '')}`);
}

export function vBinary(dir) {
  return join(dir, process.platform === 'win32' ? 'v.exe' : 'v');
}

export function listInstalled(root = VVM_ROOT) {
  const dir = versionsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(vBinary(join(dir, e.name))))
    .map((e) => e.name.replace(/^v/, ''))
    .filter((v) => !VERSION_ALIASES.has(v.toLowerCase()))
    .sort(compareVersions);
}

export function activeVersion(root = VVM_ROOT) {
  const file = join(root, '.active-version');
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').trim();
}

export function setActiveVersion(version, root = VVM_ROOT) {
  writeFileSync(join(root, '.active-version'), `${version.replace(/^v/, '')}\n`);
}

export function resolveV(root = VVM_ROOT) {
  const active = activeVersion(root);
  if (active) {
    const bin = vBinary(versionDir(active, root));
    if (existsSync(bin)) return bin;
  }
  const installed = listInstalled(root);
  if (installed.length > 0) return vBinary(versionDir(installed[installed.length - 1], root));
  return '';
}

// Aliases accepted anywhere a version is expected: latest (+ stable/lts/current),
// optional leading `v` (v0.5.2 == 0.5.2).
export const VERSION_ALIASES = new Set(['latest', 'stable', 'lts', 'current']);

export function normalizeVersion(input) {
  const v = String(input || '').trim().replace(/^v/i, '').toLowerCase();
  if (VERSION_ALIASES.has(v)) return 'latest';
  return v;
}

function semverParts(v) {
  return v.split('.').map((n) => {
    const m = /^\d+/.exec(n);
    return m ? parseInt(m[0], 10) : -1;
  });
}

export function compareVersions(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function detectVersion(bin) {
  try {
    const out = execFileSync(bin, ['version']).toString().trim();
    const m = out.match(/V\s+(\d+\.\d+\.\d+)/i);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

export function downloadUrl(version, asset) {
  const tag = String(version).replace(/^v/i, '');
  if (tag.toLowerCase() === 'latest') return `https://github.com/vlang/v/releases/latest/download/${asset}`;
  return `https://github.com/vlang/v/releases/download/${tag}/${asset}`;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

function extract(zipFile, outDir) {
  mkdirSync(outDir, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zipFile}' '${outDir}'`], { stdio: 'inherit' });
    return;
  }
  try {
    execFileSync('unzip', ['-q', '-o', zipFile, '-d', outDir], { stdio: 'inherit' });
  } catch {
    execFileSync('tar', ['-xf', zipFile, '-C', outDir], { stdio: 'inherit' });
  }
}

function flattenSingleDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '__MACOSX');
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = join(dir, entries[0].name);
    const tmp = join(dir, `__vvm_inner_${Date.now()}`);
    renameSync(inner, tmp);
    for (const e of readdirSync(tmp)) renameSync(join(tmp, e), join(dir, e));
    rmSync(tmp, { recursive: true });
  }
}

export async function installVersion(version, { force = false, root = VVM_ROOT } = {}) {
  const key = platformKey();
  const asset = ASSETS[key];
  if (!asset) throw new Error(`unsupported platform "${key}" (${process.platform}/${process.arch})`);
  let tag = normalizeVersion(version);
  const isAlias = tag === 'latest';
  let dir = versionDir(tag, root);
  let bin = vBinary(dir);
  if (!isAlias && !force && existsSync(bin)) {
    const out = execFileSync(bin, ['version']).toString().trim();
    console.log(`${out} → already installed at ${dir}`);
    return dir;
  }
  const url = downloadUrl(version, asset);
  const zipFile = join(tmpdir(), `vvm-v-${Date.now()}-${asset}`);
  const stageDir = join(versionsDir(root), `.stage-${Date.now()}`);
  console.log(`vvm: downloading ${url}`);
  await download(url, zipFile);
  console.log(`vvm: extracting to ${dir}`);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  extract(zipFile, stageDir);
  flattenSingleDir(stageDir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(versionsDir(root), { recursive: true });
  renameSync(stageDir, dir);
  rmSync(zipFile, { force: true });
  // `latest` is a download alias — store the toolchain under its real version
  // (e.g. versions/v0.5.2) instead of versions/vlatest.
  let finalTag = tag;
  if (isAlias) {
    const detected = detectVersion(bin);
    if (detected) {
      finalTag = detected;
      const finalDir = versionDir(finalTag, root);
      if (!force && existsSync(vBinary(finalDir))) {
        rmSync(dir, { recursive: true, force: true });
        console.log(`vvm: latest is ${finalTag} — already installed at ${finalDir}`);
        dir = finalDir;
        bin = vBinary(dir);
      } else {
        rmSync(finalDir, { recursive: true, force: true });
        renameSync(dir, finalDir);
        dir = finalDir;
        bin = vBinary(dir);
      }
      // migrate pre-fix `vlatest` leftovers / active pointer
      if (activeVersion(root) === 'latest') setActiveVersion(finalTag, root);
    }
  }
  const out = execFileSync(bin, ['version']).toString().trim();
  console.log(`vvm: ${out} → ${dir}`);
  if (!activeVersion(root)) {
    setActiveVersion(finalTag, root);
    console.log(`vvm: using ${finalTag} (default — first install)`);
  }
  return dir;
}

function printHelp() {
  console.log(`vvm ${VVM_VERSION} — V Version Manager
Usage: vvm <command> [args]

  install <version> [--force]   Download + extract V (e.g. vvm install 0.5.2, vvm install latest)
  use <version>                 Set active version (writes .active-version)
  ls | list                     List installed versions (* = active)
  which                         Print path of the active v binary
  exec <version> -- <args...>   Run a one-off command with a given version
  current                       Print active version
  help                          This help`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }
  if (cmd === 'install') {
    const version = normalizeVersion(rest.find((a) => !a.startsWith('-')) || process.env.SWELTE_V_VERSION || process.env.SWELTE_V_VERSION || DEFAULT_V_VERSION);
    const force = rest.includes('--force') || rest.includes('-f');
    await installVersion(version, { force });
    return;
  }
  if (cmd === 'use') {
    let version = normalizeVersion(rest[0] || '');
    if (!version) {
      console.error('vvm use: missing version (e.g. vvm use 0.5.2)');
      process.exit(1);
    }
    if (version === 'latest') {
      const installed = listInstalled();
      if (installed.length === 0) {
        console.error('vvm use: no versions installed. Run: vvm install latest');
        process.exit(1);
      }
      version = installed[installed.length - 1];
    }
    const bin = vBinary(versionDir(version));
    if (!existsSync(bin)) {
      console.error(`vvm use: ${version} not installed. Run: vvm install ${version}`);
      process.exit(1);
    }
    setActiveVersion(version);
    console.log(`vvm: now using ${version} (${bin})`);
    return;
  }
  if (cmd === 'ls' || cmd === 'list') {
    const installed = listInstalled();
    const active = activeVersion();
    if (installed.length === 0) console.log('(no versions installed — run: vvm install 0.5.2)');
    for (const v of installed) console.log(`${v === active ? '*' : ' '} ${v}`);
    return;
  }
  if (cmd === 'current') {
    console.log(activeVersion() || '(none)');
    return;
  }
  if (cmd === 'which') {
    const bin = resolveV();
    if (!bin) {
      console.error('vvm which: no V installed (run: vvm install 0.5.2)');
      process.exit(1);
    }
    console.log(bin);
    return;
  }
  if (cmd === 'exec') {
    const idx = rest.indexOf('--');
    let version = normalizeVersion(idx === -1 ? rest[0] : rest.slice(0, idx)[0] || '');
    if (version === 'latest') version = activeVersion() || listInstalled().slice(-1)[0] || '';
    const args = idx === -1 ? [] : rest.slice(idx + 1);
    if (!version) {
      console.error('vvm exec: usage: vvm exec <version> -- <args...>');
      process.exit(1);
    }
    const bin = vBinary(versionDir(version));
    if (!existsSync(bin)) {
      console.error(`vvm exec: ${version} not installed. Run: vvm install ${version}`);
      process.exit(1);
    }
    execFileSync(bin, args, { stdio: 'inherit' });
    return;
  }
  console.error(`vvm: unknown command "${cmd}". Run: vvm help`);
  process.exit(1);
}

function isMainModule() {
  try {
    return realpathSync(resolve(process.argv[1] || '')) === realpathSync(join(HERE, 'vvm.js'));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`vvm: ${err.message}`);
    process.exit(1);
  });
}
