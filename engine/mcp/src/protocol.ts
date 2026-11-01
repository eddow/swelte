// Minimal JSON-RPC 2.0 over stdio (newline-delimited) for the MCP server.
// No HTTP/SSE: local IDE agents spawn this process and speak stdio.

export interface JsonRpcRequest {
	jsonrpc: '2.0'
	id: number | string | null
	method: string
	params?: Record<string, unknown>
}

export interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: number | string | null
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

export function ok(id: number | string | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result }
}

export function err(
	id: number | string | null,
	code: number,
	message: string,
	data?: unknown
): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/** Parse one line into a request; returns an error response on bad JSON. */
export function parseLine(line: string): { req: JsonRpcRequest } | { res: JsonRpcResponse } {
	let raw: unknown
	try {
		raw = JSON.parse(line)
	} catch {
		return { res: err(null, PARSE_ERROR, 'Parse error: not JSON') }
	}
	if (typeof raw !== 'object' || raw === null)
		return { res: err(null, INVALID_REQUEST, 'Invalid Request') }
	const r = raw as Record<string, unknown>
	if (r.jsonrpc !== '2.0' || typeof r.method !== 'string')
		return {
			res: err(
				typeof r.id === 'number' || typeof r.id === 'string' ? r.id : null,
				INVALID_REQUEST,
				'Invalid Request'
			),
		}
	return {
		req: {
			jsonrpc: '2.0',
			id: typeof r.id === 'number' || typeof r.id === 'string' ? r.id : null,
			method: r.method,
			params:
				typeof r.params === 'object' && r.params !== null
					? (r.params as Record<string, unknown>)
					: undefined,
		},
	}
}

export type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown

/** Dispatch one parsed request. Unknown methods -> METHOD_NOT_FOUND. */
export async function dispatch(
	req: JsonRpcRequest,
	handlers: Map<string, Handler>
): Promise<JsonRpcResponse | null> {
	const h = handlers.get(req.method)
	if (!h) return err(req.id, METHOD_NOT_FOUND, `Method not found: ${req.method}`)
	try {
		const result = await h(req.params ?? {})
		// Notifications (no id) get no response.
		if (req.id === null || req.id === undefined) return null
		return ok(req.id, result)
	} catch (e) {
		const message = (e as Error).message ?? String(e)
		const code = /invalid|missing|required|unknown|not found/i.test(message)
			? INVALID_PARAMS
			: INTERNAL_ERROR
		return err(req.id, code, message)
	}
}

/** Split a byte stream into newline-delimited lines (handles chunk splits). */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
	let buf = ''
	return (chunk: string) => {
		buf += chunk
		let idx: number
		while ((idx = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, idx).trim()
			buf = buf.slice(idx + 1)
			if (line !== '') onLine(line)
		}
	}
}
