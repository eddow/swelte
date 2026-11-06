<script lang="ts">
import { SwelteRpcError } from '@swelte/core'
import { tick } from 'svelte'
import { browser, dev } from '#app/environment'
import { say, stream } from '#routes/api/rooms.v'
import { ws_echo as wsEchoUrl } from '#routes/api/ws-echo.v'
import { ws_rooms, ws_say } from '#routes/api/ws-rooms.v'

let room = $state('lobby')
let msg = $state('hello rooms')
let sseLog: string[] = $state([])
let echoMsg = $state('hello echo')
let echoBack = $state('')
let wsRoomLog: string[] = $state([])
let note = $state('')
let sseStop: (() => void) | null = null
let wsA: WebSocket | null = null
let wsB: WebSocket | null = null

function showError(e: unknown) {
	if (e instanceof SwelteRpcError) note = e.message
	else note = String(e)
}

async function publishSse() {
	note = ''
	try {
		const n = await say({ room, msg })
		note = `published to ${n} subscriber(s)`
	} catch (e) {
		showError(e)
	}
}

async function watchSse() {
	stopSse()
	sseLog = []
	try {
		for await (const t of stream({ room })) {
			if (t === '__ping__') continue
			sseLog = [...sseLog, t]
			await tick()
		}
	} catch (e) {
		showError(e)
	}
}

function stopSse() {
	sseStop?.()
	sseStop = null
}

// WS never goes through Vite dev (no Upgrade proxy): the page is served
// from :5174 but the socket lives on the V backend (:8131). In
// preview/prod the single binary serves both, so same-origin is right.
// Runtime sniff (no build-time define — `vite build` must not bake the
// dev backend URL into dist/): dev pages run under Vite, prod under Hand.
function wsBase() {
	if (browser && dev) {
		const http =
			import.meta.env.SWELTE_V_BACKEND_URL ??
			import.meta.env.VITE_SWELTE_V_BACKEND_URL ??
			'http://localhost:8131'
		return String(http).replace(/^http/, 'ws')
	}
	return ''
}
// __swelteWsUrl already returns an absolute ws:// URL (from location.host,
// i.e. Vite :5174 in dev). Rebase the host onto the backend, don't prepend.
function wsUrl(url: string) {
	const base = wsBase()
	if (!base) return url
	try {
		const rebased = new URL(url, location.href)
		const backend = new URL(base)
		rebased.protocol = backend.protocol
		rebased.host = backend.host
		return rebased.toString()
	} catch {
		return url
	}
}

// NOTE: generated WS stubs are URL builders (same-origin) — the browser
// opens a native socket itself. In dev we rebase onto the backend.
function openEcho() {
	closeEcho()
	const sock = new WebSocket(wsUrl(wsEchoUrl({})))
	sock.onmessage = (ev) => {
		echoBack = String(ev.data)
	}
	sock.onerror = () => {
		note = 'echo socket error'
	}
	wsA = sock
}

function closeEcho() {
	try {
		wsA?.close()
	} catch {}
	wsA = null
}

function sendEcho() {
	if (wsA && wsA.readyState === WebSocket.OPEN) wsA.send(echoMsg)
	else note = 'echo socket not open'
}

function openRoomPair() {
	closeRoomPair()
	const url = wsUrl(ws_rooms({ room }))
	const a = new WebSocket(url)
	const b = new WebSocket(url)
	a.onmessage = (ev) => {
		const t = String(ev.data)
		if (t === '__ping__') return
		wsRoomLog = [...wsRoomLog, `a: ${t}`]
	}
	b.onmessage = (ev) => {
		const t = String(ev.data)
		if (t === '__ping__') return
		wsRoomLog = [...wsRoomLog, `b: ${t}`]
	}
	wsA = a
	wsB = b
}

function closeRoomPair() {
	try {
		wsA?.close()
	} catch {}
	try {
		wsB?.close()
	} catch {}
	wsA = null
	wsB = null
}

async function publishWs() {
	note = ''
	try {
		const n = await ws_say({ room, msg })
		note = `ws published to ${n} subscriber(s)`
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>chat (rooms: SSE + WS on one hub)</h1>
	<nav><a href="/">home</a></nav>
	<p>
		<label>room <input bind:value={room}></label>
		<label>message <input bind:value={msg}></label>
	</p>
	<h2>SSE room</h2>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={publishSse}>publish via say (rpc)</button>
		<button onclick={watchSse}>watch stream (SSE)</button>
		<button onclick={stopSse}>stop</button>
	</div>
	{#if sseLog.length}
		<ul>
			{#each sseLog as m}
				<li>{m}</li>
			{/each}
		</ul>
	{/if}
	<h2>WS echo</h2>
	<p>
		<label>echo <input bind:value={echoMsg}></label>
		<button onclick={openEcho}>open /api/ws-echo</button>
		<button onclick={sendEcho}>send</button>
		<button onclick={closeEcho}>close</button>
	</p>
	{#if echoBack}
		<p>echo: {echoBack}</p>
	{/if}
	<h2>WS rooms (two sockets, one room)</h2>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={openRoomPair}>open pair</button>
		<button onclick={publishWs}>publish via ws_say</button>
		<button onclick={closeRoomPair}>close pair</button>
	</div>
	{#if wsRoomLog.length}
		<ul>
			{#each wsRoomLog as m}
				<li>{m}</li>
			{/each}
		</ul>
	{/if}
	{#if note}
		<p>{note}</p>
	{/if}
</main>
