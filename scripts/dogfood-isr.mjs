import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export async function checkIsr(url, app) {
  const get = () => fetch(`${url}isr`, { headers: { accept: 'text/html' } })
  const wait = async (expected) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const response = await get()
      const html = await response.text()
      if (response.headers.get('X-Swelte-Cache') && html.includes(`id="isr-value">${expected}`)) return response
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`ISR did not publish ${expected}`)
  }
  writeFileSync(join(app, 'isr-value'), 'initial')
  assert.equal((await get()).status, 200)
  const hit = await wait('initial')
  assert.match(hit.headers.get('Cache-Control'), /stale-while-revalidate/)
  writeFileSync(join(app, 'isr-value'), 'regenerated')
  await new Promise(resolve => setTimeout(resolve, 1100))
  const stale = await get()
  assert.equal(stale.headers.get('X-Swelte-Cache'), 'STALE')
  assert.match(await stale.text(), /id="isr-value">initial/)
  await wait('regenerated')
  writeFileSync(join(app, 'isr-fail'), 'fail')
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.match(await (await get()).text(), /id="isr-value">regenerated/)
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.match(await (await get()).text(), /id="isr-value">regenerated/)
  rmSync(join(app, 'isr-fail'))
  writeFileSync(join(app, 'isr-value'), 'private-live')
  const personal = await fetch(`${url}isr`, { headers: { accept: 'text/html', cookie: 'session=private' } })
  assert.equal(personal.headers.get('X-Swelte-Cache'), null)
  assert.match(await personal.text(), /id="isr-value">private-live/)
  const data = await fetch(`${url}isr`, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } })
  assert.equal(data.headers.get('X-Swelte-Cache'), null)
  console.log('PASS: native ISR stale reads, atomic regeneration, failure retention and personalized/data bypass')
}
