import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkPrerender(root, app, binary) {
  const { runPrerender } = await import(pathToFileURL(join(root, 'engine/core/dist/commands/prerender.js')))
  const entriesFile = join(app, '.swelte/entries.json')
  const original = readFileSync(entriesFile, 'utf8')
  const entries = JSON.parse(original)
  assert.ok(entries.expanded.includes('/fr/article/caf%C3%A9'))
  assert.ok(!entries.routes.includes('/'), 'root must remain dynamic')
  assert.ok(!entries.dynamics.includes('/[lang]/private'), 'group prerender=false must apply')
  const dist = join(app, 'dist')
  const shell = readFileSync(join(dist, 'index.html'), 'utf8')
  const config = { outDir: '.swelte', distDir: 'dist', prerender: { concurrency: 3 } }
  const messages = []
  const hooks = { log: message => messages.push(message) }
  const oldOrigin = process.env.SWELTE_ORIGIN
  process.env.SWELTE_ORIGIN = 'https://dogfood.example'
  try {
    const result = await runPrerender(app, binary, config, hooks)
    for (const [locale, slug, title] of [['en', 'welcome', 'Hello welcome'], ['fr', 'café', 'Bonjour café'], ['ro', 'bun-venit', 'Salut bun-venit']]) {
      const relative = `${locale}/article/${slug}/index.html`
      assert.ok(result.pages.includes(relative), JSON.stringify(result))
      const html = readFileSync(join(dist, relative), 'utf8')
      assert.ok(html.includes(`<title>${title}</title>`), html.slice(0, 500))
      assert.ok(html.includes(`content="${locale}"`))
      assert.ok(html.includes(`href="https://dogfood.example/${locale}/article/${encodeURIComponent(slug)}"`))
      assert.doesNotMatch(html, /<!--ssr-body-->|data-swelte-render-error/)
      assert.ok(html.includes('id="__swelte_page"'))
    }
    assert.ok(!existsSync(join(dist, 'en/article/redirect/index.html')))
    assert.ok(!existsSync(join(dist, 'en/article/broken/index.html')))
    assert.ok(messages.some(message => message.includes('/en/article/redirect') && message.includes('303')))
    assert.ok(messages.some(message => message.includes('/en/article/broken') && message.includes('500')))
    assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), shell)
    mkdirSync(join(dist, 'manual'), { recursive: true })
    writeFileSync(join(dist, 'manual/index.html'), 'unowned')
    writeFileSync(entriesFile, JSON.stringify({ ...entries, routes: [], expanded: [] }))
    await runPrerender(app, binary, config, hooks)
    assert.ok(!existsSync(join(dist, 'fr/article/café/index.html')), 'disabled artifact must be removed')
    assert.equal(readFileSync(join(dist, 'manual/index.html'), 'utf8'), 'unowned')
    writeFileSync(entriesFile, original)
    await runPrerender(app, binary, config, hooks)
  } finally {
    writeFileSync(entriesFile, original)
    if (oldOrigin === undefined) delete process.env.SWELTE_ORIGIN
    else process.env.SWELTE_ORIGIN = oldOrigin
  }
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      let file = resolve(dist, '.' + pathname)
      if (!file.startsWith(dist + sep)) throw new Error('outside dist')
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(readFileSync(file))
    } catch { response.statusCode = 404; response.end('not found') }
  })
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  console.log('PASS: translated grouped dynamic prerender, canonical/head, opt-outs, redirect/error rejection and owned artifact cleanup')
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolveClose => server.close(resolveClose)) }
}
