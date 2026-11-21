import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { launchDevApplication } from './dev-control.js'

const fixture = `
const net = require('node:net');
const [host, port] = process.env.SWELTE_DEV_CONTROL.split(':');
const socket = net.connect({host, port: Number(port)});
const send = (message) => socket.write(JSON.stringify(message) + '\\n');
socket.on('connect', () => send({type:'hello', version:process.env.TEST_MODE === 'wrong-version' ? 2 : 1,
 token: process.env.TEST_MODE === 'wrong-token' ? 'incorrect' : process.env.SWELTE_DEV_TOKEN,
 generation:Number(process.env.SWELTE_DEV_GENERATION) + (process.env.TEST_MODE === 'wrong-generation' ? 1 : 0),
 pid:process.pid + (process.env.TEST_MODE === 'wrong-pid' ? 1 : 0)}));
let buffer = '';
socket.on('data', (chunk) => {
 buffer += chunk;
 let index;
 while ((index = buffer.indexOf('\\n')) >= 0) {
  const message = JSON.parse(buffer.slice(0,index)); buffer = buffer.slice(index+1);
  if (message.type === 'accepted' && process.env.TEST_MODE !== 'unready') send({type:'ready'});
  if (message.type === 'stop' && process.env.TEST_MODE !== 'hung') {
   send({type:'stopping'}); send({type:'stopped'});
   setTimeout(() => process.exit(0), 100);
  }
 }
});
socket.on('error', () => {});
socket.on('close', () => process.exit(0));
`

async function application(mode = '') {
	const root = mkdtempSync(join(tmpdir(), 'swelte-control-'))
	const script = join(root, 'application.cjs')
	writeFileSync(script, fixture)
	const messages: string[] = []
	const app = await launchDevApplication(
		{ file: process.execPath, args: [script] },
		{
			env: { ...process.env, TEST_MODE: mode },
			stdio: 'ignore',
		},
		{
			generation: 1,
			shutdownMs: 100,
			startupMs: mode === 'unready' ? 100 : 5000,
			log: (m) => messages.push(m),
		}
	)
	return {
		app,
		messages,
		cleanup: async () => {
			await app.stop('test-cleanup')
			rmSync(root, { recursive: true, force: true })
		},
	}
}

it('cooperatively stops without any signal and waits beyond the stopped message for exit', async (t) => {
	const { app, cleanup } = await application()
	try {
		await app.ready
		const kill = t.mock.method(app.child, 'kill')
		const stopped = app.stop('restart')
		assert.equal(app.stop('quit'), stopped)
		assert.equal(app.child.exitCode, null)
		await stopped
		assert.equal(app.child.exitCode, 0)
		assert.equal(kill.mock.callCount(), 0)
	} finally {
		await cleanup()
	}
})

it('forces only its owned hung child after the cooperative deadline', async (t) => {
	const { app, messages, cleanup } = await application('hung')
	try {
		await app.ready
		const kill = t.mock.method(app.child, 'kill')
		await app.stop('quit')
		assert.equal(kill.mock.callCount(), 1)
		assert.deepEqual(kill.mock.calls[0].arguments, ['SIGKILL'])
		assert.match(messages.join('\n'), /shutdown exceeded/)
	} finally {
		await cleanup()
	}
})

it('startup timeout requests cooperative shutdown without launching an unready child', async () => {
	const { app, cleanup } = await application('unready')
	try {
		await assert.rejects(app.ready, /startup deadline/)
		await app.exited
		assert.equal(app.child.exitCode, 0)
	} finally {
		await cleanup()
	}
})

it('reports a missing executable and closes its control listener', async () => {
	const app = await launchDevApplication(
		{ file: 'swelte-missing-native-application' },
		{ stdio: 'ignore' },
		{
			generation: 1,
			shutdownMs: 100,
			log: () => {},
		}
	)
	await assert.rejects(app.ready, /ENOENT/)
	await app.stop('quit')
})

for (const mode of ['wrong-token', 'wrong-generation', 'wrong-version', 'wrong-pid']) {
	it(`rejects ${mode} before accepting lifecycle events`, async () => {
		const { app, cleanup } = await application(mode)
		try {
			await assert.rejects(app.ready, /exited before readiness/)
		} finally {
			await cleanup()
		}
	})
}
