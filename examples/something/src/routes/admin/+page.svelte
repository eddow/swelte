<script lang="ts">
import { admin_whoami } from '#routes/admin/+page.v'
import { SwelteRpcError } from '@swelte/core'

let whoami = $state('')
let lastError = $state('')

async function load() {
	lastError = ''
	try {
		whoami = await admin_whoami({})
	} catch (e) {
		lastError = e instanceof SwelteRpcError ? e.message : String(e)
	}
}
</script>

<main>
	<h1>admin</h1>
	<button onclick={load}>Who am I (guarded GET)</button>
	{#if whoami}<p>{whoami}</p>{/if}
	{#if lastError}<pre style="color:crimson">{lastError}</pre>{/if}
</main>
