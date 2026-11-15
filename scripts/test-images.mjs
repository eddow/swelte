import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, symlinkSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildImages, normalizeImages } from '../engine/core/dist/commands/images.js'
import { resolveV, resolveCC, toolchainEnv } from '../engine/core/dist/toolchain.js'
const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root,'tmp'), { recursive: true })
const scratch = mkdtempSync(join(root,'tmp','images-test-'))
try {
  copyFileSync(join(root,'fixtures/images/alpha.png'), join(scratch,'alpha.png'))
  const options = normalizeImages([{ src: 'alpha.png', widths: [8, 16, 32], quality: 80 }])
  const manifest = buildImages(scratch, options, '.generated', '/base')
  assert.deepEqual(manifest['alpha.png'].map(({width,height})=>[width,height]), [[8,4],[16,8]], 'aspect ratio, no upscaling and duplicate removal')
  const again = buildImages(scratch, options, '.generated', '/base')
  assert.deepEqual(again, manifest, 'stable asset names')
  const changed = buildImages(scratch, normalizeImages([{src:'alpha.png',widths:[8],quality:60}]), '.other')
  assert.notEqual(changed['alpha.png'][0].src, manifest['alpha.png'][0].src.replace('/base',''), 'encoding options invalidate asset names')
  for (const variant of manifest['alpha.png']) {
    const file = join(scratch,'.generated/.images',variant.src.split('/').at(-1))
    const data = readFileSync(file)
    assert.equal(data.toString('ascii',0,4),'RIFF')
    assert.equal(data.toString('ascii',8,12),'WEBP')
    writeFileSync(join(scratch,'decode.v'), `module main
import os
#pkgconfig libwebp
#include <webp/decode.h>
fn C.WebPDecodeRGBA(&u8, usize, &int, &int) &u8
fn C.WebPFree(voidptr)
fn main() {
bytes := os.read_bytes(os.args[1])!
mut w := 0
mut h := 0
pixels := C.WebPDecodeRGBA(bytes.data, usize(bytes.len), &w, &h)
assert pixels != unsafe { nil }
assert w == ${variant.width} && h == ${variant.height}
unsafe { assert pixels[3] == 128 }
C.WebPFree(pixels)
}`)
    execFileSync(resolveV(import.meta.url), ['-cc', resolveCC(), 'run', join(scratch,'decode.v'), file], {env:toolchainEnv(),stdio:'pipe',timeout:120000})
  }
  assert.throws(()=>buildImages(scratch, normalizeImages([{src:'../elsewhere.png',widths:[8]}])), /ENOENT|escapes/)
  const app = join(scratch, 'app')
  cpSync(join(root, 'engine/core/templates/base'), app, { recursive: true, filter: source => !['.swelte','dist','node_modules'].includes(source.split('/').at(-1)) })
  symlinkSync(join(root, 'node_modules'), join(app, 'node_modules'), 'dir')
  copyFileSync(join(root, 'fixtures/images/alpha.png'), join(app, 'photo.png'))
  writeFileSync(join(app, 'package.json'), JSON.stringify({name:'image-build-test',type:'module',private:true,version:'0.0.0'}))
  writeFileSync(join(app, 'svelte.config.js'), `import { defineConfig } from '@swelte/core/config'; export default defineConfig({ swelte: { images: [{ src: 'photo.png', widths: [8,16] }] } });`)
  writeFileSync(join(app, 'src/routes/+page.svelte'), `<script>import images from '#app/images'; const image = images['photo.png'][0]</script><img src={image.src} width={image.width} height={image.height} alt="A red square" />`)
  const { runBuild } = await import('../engine/core/dist/commands/build.js')
  await runBuild({argv:[],opts:{root:app,local:true},rest:[],log:()=>{},error:message=>{throw new Error(message)}})
  const published = JSON.parse(readFileSync(join(app,'dist/images/manifest.json'),'utf8'))
  assert.equal(published['photo.png'].length, 2)
  for (const variant of published['photo.png']) assert.ok(existsSync(join(app,'dist',variant.src)))
  assert.ok(existsSync(join(app,'dist/server')))
  if (process.platform === 'linux') assert.doesNotMatch(execFileSync('ldd',[join(app,'dist/server')],{encoding:'utf8',env:toolchainEnv()}), /libwebp/)
  console.log('PASS: native image resize, WebP decode, alpha, aspect ratio, bounded widths and content-addressed assets')
} finally { if (process.argv.includes('--keep')) console.log('kept:', scratch); else rmSync(scratch,{recursive:true,force:true}) }
