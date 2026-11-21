#!/usr/bin/env node
// DF-01: exercise a packed native/UI library through the real build paths.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const keep = process.argv.includes('--keep')
const production = process.argv.includes('--prod')
const originalCwd = process.cwd()
// The compiler's automatic remote bug reporter is inappropriate for fixtures.
process.env.V_C_ERROR_BUG_REPORT_DISABLED = '1'
if (process.env.SWELTE_TEST_NATIVE_DEPS) {
  const deps = resolve(process.env.SWELTE_TEST_NATIVE_DEPS)
  process.env.PKG_CONFIG_PATH = join(deps, 'usr/lib/x86_64-linux-gnu/pkgconfig')
  process.env.PKG_CONFIG_SYSROOT_DIR = deps
}
mkdirSync(join(root, 'tmp'), { recursive: true })
const scratch = mkdtempSync(join(root, 'tmp', 'dogfood-'))
let server
let staticHost
let serverLog = ''

function run(command, args, cwd = root, env = process.env) {
  try {
    return execFileSync(command, args, {
      cwd, env, encoding: 'utf8', timeout: 180_000,
      shell: process.platform === 'win32' && command === 'npm',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed\n${error.stdout ?? ''}${error.stderr ?? error.message}`)
  }
}

function copyFixture(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter: path => !['node_modules', 'dist', 'package', '.swelte', '.svelte-kit'].includes(basename(path)),
  })
}

async function availablePort() {
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolveClose, reject) => socket.close(error => error ? reject(error) : resolveClose()))
  return port
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`native server exited: ${serverLog}`)
    try {
      return await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1000) })
    } catch {
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
    }
  }
  throw new Error(`native server did not start: ${serverLog}`)
}

try {
  console.log('dogfood: building current core and SSR adapter')
  const tsc = require.resolve('typescript/bin/tsc')
  for (const name of ['core', 'ssr-qjs']) {
    run(process.execPath, [tsc, '-p', `engine/${name}/tsconfig.json`])
  }
  const { swelte, dbPlugin, jobsPlugin } = await import(pathToFileURL(join(root, 'engine/core/dist/vite.js')))
  const startupProbe = { name: 'startup-probe', attrs: [], harness: () => ({ mainInner: "\tos.write_file('dependent-plugin-started', 'yes')!\n" }) }
  const fixturePlugins = [dbPlugin, jobsPlugin, startupProbe]
  const { resolveV, resolveCC, toolchainEnv, vVersion } = await import(pathToFileURL(join(root, 'engine/core/dist/toolchain.js')))
  const { emitRenderJs } = await import(pathToFileURL(join(root, 'engine/ssr-qjs/dist/ssr.js')))
  const { buildQjsProd } = await import(pathToFileURL(join(root, 'engine/ssr-qjs/dist/qjs.js')))
  const { build, version: viteVersion } = await import('vite')
  const { svelte } = await import('@sveltejs/vite-plugin-svelte')
  const v = resolveV(import.meta.url)
  const env = toolchainEnv()
  console.log(`dogfood: ${vVersion(v)}; Svelte ${require('svelte/package.json').version}; Vite ${viteVersion}; TypeScript ${require('typescript/package.json').version}`)

  const fixture = join(root, 'fixtures/dogfood')
  const app = join(scratch, 'app')
  const library = join(scratch, 'library')
  copyFixture(join(fixture, 'app'), app)
  const postgres = process.argv.includes('--postgres')
  if (postgres) {
    if (!process.env.DATABASE_URL) throw new Error('--postgres requires a disposable DATABASE_URL; use npm run test:postgres')
    copyFixture(join(root, 'fixtures/postgres/app'), app)
  }
  copyFixture(join(fixture, 'sample-lib'), library)
  // Library publish build via the CLI (Swelte-owned temp under .swelte/,
  // never .svelte-kit) + schema validation, same as `npm run package`.
  run(process.execPath, [join(root, 'engine', 'core', 'bin', 'swelte.js'), 'package', '--root', library])
  const { collectLibDiagnostics } = await import(pathToFileURL(join(root, 'engine/core/dist/gen/diagnostics.js')))
  const libDiags = collectLibDiagnostics(library).filter(
    (d) => !(d.kind === 'lib-exports' && d.message.startsWith('no swelte.v.exports'))
  )
  assert.deepEqual(libDiags, [])
  const packed = JSON.parse(run('npm', ['pack', library, '--json', '--ignore-scripts', '--pack-destination', scratch]))[0]
  assert.ok(packed.files.every(file => !file.path.startsWith('src/routes/')), 'library author routes must never be packed')
  const tarball = join(scratch, packed.filename)
  const pkgFile = join(app, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  pkg.dependencies = { '@swelte-dogfood/sample-lib': `file:${tarball}` }
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
  run('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false'], app)
  const installed = join(app, 'node_modules/@swelte-dogfood/sample-lib')
  assert.ok(existsSync(join(installed, 'src/lib/backend/runner/formatting/formatting.v')))
  assert.ok(existsSync(join(installed, 'package/Panel.svelte.d.ts')))
  assert.ok(!existsSync(join(installed, 'src/routes')))
  console.log('dogfood: packed dependency installed, including nested V and UI types')

  // cwd matches normal CLI builds; all package imports use installed exports.
  process.chdir(app)
  const invalidEntry = join(app, 'browser-invalid.ts')
  writeFileSync(invalidEntry, 'import { run } from "@swelte-dogfood/sample-lib/v/runner.v"; console.log(run);\n')
  await assert.rejects(
    () => build({
      root: app, configFile: false, logLevel: 'silent', plugins: [swelte({ plugins: fixturePlugins })],
      build: { write: false, rollupOptions: { input: invalidEntry } },
    }),
    /server-only/
  )
  run(process.execPath, [tsc, '-p', join(app, 'tsconfig.json')], app, env)
  console.log('dogfood: installed UI/universal declarations resolve; server browser import rejected')

  await build({
    root: app, configFile: false, logLevel: 'warn',
    plugins: [svelte({ configFile: false }), swelte({ plugins: fixturePlugins })],
    build: { outDir: 'dist' },
  })
  const manifest = JSON.parse(readFileSync(join(app, '.swelte/ssr-manifest.json'), 'utf8'))
  const { loadConfig } = await import(pathToFileURL(join(root, 'engine/core/dist/gen/config.js')))
  writeFileSync(join(app, 'dist/isr.json'), JSON.stringify((await loadConfig(app)).isr))
  const renderJs = await emitRenderJs(manifest, { root: app, prod: true })
  buildQjsProd({ root: app, renderJs })
  const binary = join(app, process.platform === 'win32' ? 'server.exe' : 'server')
  console.log('dogfood: linking native server with installed V modules and QuickJS')
  run(v, [...(production ? ['-prod'] : []), '-enable-globals', '-cc', resolveCC(), '-path', `${join(app, '.swelte')}|@vlib|@vmodules`, '-o', binary, join(app, '.swelte')], app, env)
  writeFileSync(join(app, '.swelte/dogfood-build.json'), JSON.stringify({ optimization: production ? 'prod' : 'default', v: vVersion(v), svelte: require('svelte/package.json').version, vite: viteVersion, typescript: require('typescript/package.json').version, renderBundleBytes: readFileSync(renderJs).length }, null, 2))

  const port = await availablePort()
  // No Node executable or sidecar can be found through the runtime PATH.
  const runtimeEnv = {
    PATH: '', PORT: String(port), SWELTE_RATE_LIMIT: '1000', SWELTE_DIST: join(app, 'dist'), SWELTE_SSR: '1', SWELTE_STREAM_IDLE_MS: '500', SWELTE_SSE_HEARTBEAT_MS: '100', SWELTE_HANDLER_TIMEOUT_MS: '1000',
    ...(postgres ? { DATABASE_URL: process.env.DATABASE_URL, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PG'))) } : {}),
  }
  server = spawn(binary, [], {
    cwd: app,
    env: runtimeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.on('error', error => { serverLog += error.message })
  server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-16_000) })
  server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-16_000) })
  const url = `http://127.0.0.1:${port}/`
  const json = await waitForServer(url)
  assert.equal(json.status, 200, await json.clone().text())
  assert.deepEqual(await json.json(), {
    message: 'saved:HELLO',
    digest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  })
  const html = await fetch(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(5000) })
  const body = await html.text()
  assert.equal(html.status, 200, body)
  assert.match(body, /<title>Native package dogfood<\/title>/)
  assert.match(body, /saved:HELLO/)
  assert.match(body, /aria-label="Native package"/)
  assert.match(body, /data-swelte-ssr="1"/)
  assert.match(body, /inherited context/)
  assert.match(body, /name="dogfood-locale" content="en"/)
  const load = await fetch(`${url}?q=example&lang=fr`, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } })
  const envelope = await load.json()
  assert.equal(envelope.version, 1)
  assert.equal(envelope.data.search, 'example')
  assert.equal(envelope.data.locale, 'fr')
  assert.equal(load.headers.get('x-dogfood-guard'), 'yes')
  assert.equal(load.headers.getSetCookie().length, 2)
  const privateLoad = await fetch(`${url}?q=private-load`, { headers: { accept: 'application/json', 'X-Swelte-Load': '1', 'X-Swelte-Request-Id': 'untrusted' } })
  assert.equal(privateLoad.status, 500)
  assert.doesNotMatch(await privateLoad.text(), /private database detail/)
  const requestId = privateLoad.headers.get('x-swelte-request-id')
  assert.match(requestId, /^\d+-\d+$/)
  if (!postgres) {
    const recorded = JSON.parse(readFileSync(join(app, `report-${requestId}-load-error`), 'utf8'))
    assert.equal(recorded.message, 'private database detail')
    assert.equal(recorded.path, '/')
    assert.equal(recorded.request_id, requestId)
    assert.equal(recorded.status, 500)
    const reportFailure = await fetch(`${url}report-fail`, { headers: { accept: 'application/json' } })
    assert.equal(reportFailure.status, 200)
    await reportFailure.text()
    assert.match(serverLog, /\[swelte:report\] status=error/)
    assert.doesNotMatch(serverLog, /private reporter detail|private database detail/)
  }
  const denied = await fetch(`${url}?deny=1`, { headers: { accept: 'text/html' }, redirect: 'manual' })
  assert.equal(denied.status, 303)
  assert.equal(denied.headers.get('location'), '/?login=1')
  const deniedAction = await fetch(`${url}actions?/save&deny=1`, { method: 'POST', body: new URLSearchParams({ title: 'denied' }), headers: { accept: 'application/json' }, redirect: 'manual' })
  assert.equal(deniedAction.status, 303)
  assert.ok(!existsSync(join(app, 'action-executed')), 'guard must run before action side effects')
  const crossOrigin = await fetch(`${url}actions?/save`, { method: 'POST', body: new URLSearchParams({ title: 'denied' }), headers: { accept: 'application/json', origin: `http://${new URL(url).host}.evil.invalid` }, redirect: 'manual' })
  assert.equal(crossOrigin.status, 403)
  assert.ok(!existsSync(join(app, 'action-executed')), 'origin rejection must precede action side effects')
  const deniedBinary = await fetch(`${url}download?deny=1`, { redirect: 'manual' })
  assert.equal(deniedBinary.status, 303)
  const binaryResponse = await fetch(`${url}download`)
  assert.deepEqual([...new Uint8Array(await binaryResponse.arrayBuffer())], [0, 1, 2, 255])
  assert.equal(binaryResponse.headers.get('x-dogfood-guard'), 'yes')
  const dynamicHtml = await fetch(`${url}items/alpha?q=detail&lang=fr`, { headers: { accept: 'text/html' } })
  assert.equal(dynamicHtml.status, 200)
  const dynamicBody = await dynamicHtml.text()
  assert.match(dynamicBody, /<title>Item alpha<\/title>/)
  assert.match(dynamicBody, /alpha:detail:fr/)
  const noJs = await fetch(`${url}?/save&q=example&filter=unread`, { method: 'POST', body: new URLSearchParams({ title: 'test' }), headers: { accept: 'text/html' }, redirect: 'manual' })
  assert.equal(noJs.status, 303)
  assert.equal(noJs.headers.get('location'), '/?q=example&filter=unread')
  const failure = await fetch(`${url}?/save&q=example`, { method: 'POST', body: new URLSearchParams({ title: '' }), headers: { accept: 'text/html' } })
  assert.equal(failure.status, 422)
  assert.match(await failure.text(), /id="validation">required/)
  const nestedError = await fetch(`${url}items/denied?lang=fr`, { headers: { accept: 'text/html' } })
  assert.equal(nestedError.status, 403)
  const nestedHtml = await nestedError.text()
  assert.match(nestedHtml, /id="item-error">Item 403: item denied/)
  assert.match(nestedHtml, /id="layout-locale">fr:/)
  assert.match(nestedHtml, /data-swelte-error-boundary="items%2F%2Berror.svelte"/)
  const actionError = await fetch(`${url}?/save`, { method: 'POST', body: new URLSearchParams({ title: 'explode' }), headers: { accept: 'text/html' } })
  assert.equal(actionError.status, 500)
  assert.match(await actionError.text(), /id="page-error">500:/)
  const localized = await Promise.all(['fr', 'ro', 'en', 'de'].map(async lang => {
    const res = await fetch(`${url}?lang=${lang}`, { headers: { accept: 'text/html' } })
    assert.match(await res.text(), new RegExp(`name="dogfood-locale" content="${lang}"`))
  }))
  void localized
  assert.doesNotMatch(body, /Awaiting native data|swelte:ssr:/)
  const renderFailure = await fetch(`${url}?q=render-fail`, { headers: { accept: 'text/html' } })
  const failedHtml = await renderFailure.text()
  assert.equal(renderFailure.status, 500)
  assert.doesNotMatch(failedHtml, /private renderer failure/)
  const failedState = JSON.parse(failedHtml.match(/id="__swelte_page">(.*?)<\/script>/s)[1])
  assert.equal(failedState.error.status, 500)
  assert.equal(failedState.error.message, 'render failed')
  if (!postgres) {
    const report = JSON.parse(readFileSync(join(app, `report-${renderFailure.headers.get('x-swelte-request-id')}-ssr-error`), 'utf8'))
    assert.equal(report.message, 'render failed', 'original JS diagnostics must be opt-in')
  }
  const timedOut = await fetch(`${url}?q=timeout`, { headers: { 'X-Swelte-Load': '1', accept: 'application/json' } })
  assert.equal(timedOut.status, 504)
  assert.equal((await timedOut.json()).error.status, 504)
  const { checkIsr } = await import('./dogfood-isr.mjs')
  await checkIsr(url, app)
  const { checkStreams } = await import('./dogfood-stream.mjs')
  await checkStreams(url, app)
  const { checkStrictSsr } = await import('./dogfood-ssr.mjs')
  await checkStrictSsr(binary, app, runtimeEnv, await availablePort(), !postgres)
  const { checkShutdown } = await import('./dogfood-shutdown.mjs')
  await checkShutdown(binary, scratch, runtimeEnv, availablePort, postgres)
  if (postgres) {
    assert.ok(existsSync(join(app, 'dependent-job-started')))
    const check = join(scratch, 'pg-check')
    run(v, ['-enable-globals', '-cc', resolveCC(), '-path', `${join(app, '.swelte')}|@vlib|@vmodules`, '-o', check, join(root, 'fixtures/postgres/check.v')], app, env)
    console.log(run(check, [], app, runtimeEnv).trim())
    const threadUrl = `${url}threads?filter=unread&q=example`
    const add = await fetch(`${url}threads?/add&filter=unread&q=example`, { method: 'POST', body: new URLSearchParams({ title: 'example thread' }), headers: { accept: 'text/html' }, redirect: 'manual' })
    assert.equal(add.status, 303)
    assert.equal(add.headers.get('location'), '/threads?filter=unread&q=example')
    const threadLoad = await fetch(threadUrl, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } })
    const loaded = await threadLoad.json()
    assert.equal(loaded.route.id, '/(priv)/threads')
    assert.equal(loaded.data.threads.length, 1)
    assert.equal(loaded.data.threads[0].note, null)
    assert.equal(loaded.data.threads[0].amount, '12.3400')
    assert.match(loaded.data.threads[0].created_at, /Z$/)
    const threadHtml = await fetch(threadUrl, { headers: { accept: 'text/html' } })
    assert.match(await threadHtml.text(), /example thread/)
    const badCwd = join(scratch, 'failed-startup')
    mkdirSync(badCwd)
    const { spawnSync } = await import('node:child_process')
    const failed = spawnSync(binary, [], { cwd: badCwd, env: { ...runtimeEnv, PORT: String(await availablePort()), SWELTE_TEST_MIGRATION_FAIL: '1' }, encoding: 'utf8', timeout: 15_000 })
    assert.notEqual(failed.status, 0, 'failed migration must abort startup')
    assert.ok(!existsSync(join(badCwd, 'dependent-job-started')), 'dependent jobs must not start after failed migrations')
    assert.ok(!existsSync(join(badCwd, 'dependent-plugin-started')), 'plugin startup must not precede successful migrations')
    console.log('PASS: native PostgreSQL load/mutation on /threads; grouped identity, wire types and failed startup before dependent work')
  }
  const { checkPrerender } = await import('./dogfood-prerender.mjs')
  staticHost = await checkPrerender(root, app, binary)
  if (process.argv.includes('--browser')) {
    const { checkBrowser } = await import('./dogfood-browser.mjs')
    await checkBrowser(url, scratch, staticHost.url, app)
  }
  console.log('PASS: installed native/UI package, browser build, native JSON and QuickJS HTML with empty runtime PATH')
} finally {
  await staticHost?.close()
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    const watchdog = setTimeout(() => server.kill('SIGKILL'), 3000)
    await exited
    clearTimeout(watchdog)
  }
  process.chdir(originalCwd)
  if (keep) console.log(`kept: ${scratch}`)
  else rmSync(scratch, { recursive: true, force: true })
}
