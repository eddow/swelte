// `swelte-mcp` CLI entry. No args: serve MCP over stdio.
// `--help` / `--version` for humans; unknown args are an error.
import { serveStdio } from './server.js'
import { VERSION } from './version.js'

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log('Usage: swelte-mcp [--help] [--version]')
		console.log('')
		console.log('Swelte MCP server (stdio): route tree, type contracts, diagnostics.')
		console.log(`\nswelte-mcp v${VERSION}`)
		return
	}
	if (argv.includes('--version') || argv.includes('-V')) {
		console.log(VERSION)
		return
	}
	if (argv.length > 0) {
		console.error(`swelte-mcp: unknown argument "${argv[0]}" (stdio server takes no args).`)
		process.exitCode = 1
		return
	}
	await serveStdio()
}
