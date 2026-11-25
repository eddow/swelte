import { createServer } from 'vite'
import { swelte } from '../engine/core/dist/vite.js'
import { dbPlugin } from '../engine/plus/dist/db.js'
import { jobsPlugin } from '../engine/plus/dist/jobs.js'
import { roomsPlugin } from '../engine/plus/dist/rooms.js'
import { fileURLToPath } from 'node:url'

// Vite's config phase generates the same editor types as the fixture build.
const server = await createServer({
  root: fileURLToPath(new URL('../fixtures/dogfood/app', import.meta.url)),
  configFile: false,
  plugins: [swelte({ plugins: [dbPlugin, jobsPlugin, roomsPlugin] })],
  server: { watch: null },
})
await server.close()
