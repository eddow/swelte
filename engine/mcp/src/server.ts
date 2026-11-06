// MCP server entry: stdio JSON-RPC loop + MCP handshake methods.
// Methods: initialize, tools/list, tools/call (+ ping, notifications/initialized).

import type { Handler, JsonRpcRequest } from './protocol.js'
import { createLineSplitter, dispatch, err, parseLine } from './protocol.js'
import { HANDLERS, serverInfo, TOOLS } from './tools.js'
import { VERSION } from './version.js'

const MCP_METHODS = new Map<string, Handler>([
	[
		'initialize',
		() => ({
			...serverInfo(),
			serverInfo: { name: 'swelte', version: VERSION },
		}),
	],
	['ping', () => ({})],
	['notifications/initialized', () => ({})],
	['tools/list', () => ({ tools: TOOLS })],
	[
		'tools/call',
		async (params) => {
			const name = params.name
			if (typeof name !== 'string' || name === '') throw new Error('missing required param: name')
			const h = HANDLERS.get(name)
			if (!h) throw new Error(`unknown tool: ${name}`)
			const args =
				typeof params.arguments === 'object' && params.arguments !== null
					? (params.arguments as Record<string, unknown>)
					: {}
			const data = (await h(args)) as Record<string, unknown>
			return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
		},
	],
])

export function createHandlers(): Map<string, Handler> {
	return new Map(MCP_METHODS)
}

export async function handleRequest(req: JsonRpcRequest): Promise<ReturnType<typeof dispatch>> {
	return dispatch(req, MCP_METHODS)
}

/** Serve one JSON-RPC message line; writes the response (if any) to stdout. */
export async function serveLine(line: string, write: (s: string) => void): Promise<void> {
	const parsed = parseLine(line)
	if ('res' in parsed) {
		write(`${JSON.stringify(parsed.res)}\n`)
		return
	}
	const res = await dispatch(parsed.req, MCP_METHODS)
	if (res !== null) write(`${JSON.stringify(res)}\n`)
}

export async function serveStdio(
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout
): Promise<void> {
	input.setEncoding('utf8')
	const push = createLineSplitter((line) => {
		void serveLine(line, (s) => output.write(s)).catch((e: Error) => {
			output.write(`${JSON.stringify(err(null, -32603, e.message))}\n`)
		})
	})
	for await (const chunk of input) push(chunk as string)
}
