<script lang="ts">
import { admin_whoami } from '#routes/admin/+page.v'
import { loadPage, isPageError, isPageData, type SwelteLoadResult } from '@swelte/core'
import ErrorPage from '../+error.svelte'

let result: SwelteLoadResult<string> | null = $state(null)

async function load() {
	result = await loadPage(() => admin_whoami({}))
}
</script>

<main>
	<h1>admin</h1>
	{#if result && isPageError(result)}
		<ErrorPage status={result.error.status} message={result.error.message} />
	{:else}
		<button onclick={load}>Who am I (guarded GET)</button>
		{#if result && isPageData(result)}
			<p>{result.data}</p>
		{/if}
	{/if}
</main>
