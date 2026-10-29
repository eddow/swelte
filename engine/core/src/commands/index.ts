import type { ArgDef, Command, Ctx } from './types.js';

export const VERSION = '0.1.0';

const devCmd: Command = {
  name: 'dev',
  summary: 'Run Vite + V backend with HMR proxy (stub: prints plan until orchestration lands).',
  args: [
    { name: 'port', short: 'p', help: 'Vite port', value: 'number' },
    { name: 'backend', short: 'b', help: 'V backend port', value: 'number' },
    { name: 'root', help: 'Project root', value: 'string' },
  ],
  async run(ctx: Ctx) {
    const { resolveV, vVersion } = await import('../toolchain.js');
    const v = resolveV(import.meta.url);
    ctx.log(`V toolchain: ${vVersion(v)} (${v})`);
    ctx.log('starting Vite + V backend watcher (stub — roadmap item 2).');
    ctx.log('  - Run `vite` for the frontend.');
    ctx.log('  - Run `v run server.v` for the V backend.');
  },
};

const buildCmd: Command = {
  name: 'build',
  summary: 'Build: v check → .swelte/ → V binary + WASM → vite build (stub).',
  args: [{ name: 'root', help: 'Project root', value: 'string' }],
  async run(ctx: Ctx) {
    ctx.log('build: stub — roadmap item 3.');
  },
};

const previewCmd: Command = {
  name: 'preview',
  summary: 'Serve the built V binary only, no Vite (stub).',
  args: [
    { name: 'port', short: 'p', help: 'Port to serve on', value: 'number' },
    { name: 'root', help: 'Project root', value: 'string' },
  ],
  async run(ctx: Ctx) {
    ctx.log('preview: stub — roadmap item 4.');
  },
};

const initCmd: Command = {
  name: 'init',
  summary: 'Scaffold a new Swelte project (stub).',
  args: [{ name: 'root', help: 'Project root', value: 'string' }],
  async run(ctx: Ctx) {
    ctx.log('init: stub — roadmap item 5.');
  },
};

const checkCmd: Command = {
  name: 'check',
  summary: 'Validate .v files without a browser (stub: orphans, clashes, verb dups).',
  args: [{ name: 'root', help: 'Project root', value: 'string' }],
  async run(ctx: Ctx) {
    ctx.log('check: stub — validation strictness is roadmap item 15.');
  },
};

export const COMMANDS: Command[] = [devCmd, buildCmd, previewCmd, initCmd, checkCmd];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

export function helpText(): string {
  const lines = ['Usage: swelte <command> [options]', '', 'Commands:'];
  for (const c of COMMANDS) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`);
  lines.push('', 'Run `swelte <command> --help` for command options.');
  return lines.join('\n');
}

export function commandHelp(cmd: Command): string {
  const lines = [`Usage: swelte ${cmd.name} [options]`, '', cmd.summary, '', 'Options:'];
  const args: ArgDef[] = [...(cmd.args ?? []), { name: 'help', short: 'h', help: 'Show this help', value: 'boolean' }];
  for (const a of args) {
    const flag = a.short ? `--${a.name}, -${a.short}` : `--${a.name}`;
    lines.push(`  ${flag.padEnd(22)} ${a.help}${a.value && a.value !== 'boolean' ? ` <${a.value}>` : ''}`);
  }
  return lines.join('\n');
}
