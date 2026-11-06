<script lang="ts">
import { isPageData, isPageError, loadPage, type SwelteLoadResult } from '@swelte/core'
import { admin_whoami } from '#routes/admin/+page.v'
import ErrorPage from '../+error.svelte'

let result: SwelteLoadResult<string> | null = $state(null)

async function load() {
	result = await loadPage(() => admin_whoami({}))
}

// Item 3: force-fail trigger — throws client-side before any fetch,
// so loadPage maps the plain throw to { error: 500 } and the branch
// below renders <ErrorPage> without a full-page SSR +error render.
async function forceFail() {
	result = await loadPage(async () => {
		throw new Error('forced failure (item 3)')
	})
}
</script>

<main>
	<h1>admin</h1>
	{#if result && isPageError(result)}
		<ErrorPage status={result.error.status} message={result.error.message} />
	{:else}
		<button onclick={load}>Who am I (guarded GET)</button>
		<button onclick={forceFail}>Force fail (item 3)</button>
		{#if result && isPageData(result)}
			<p>{result.data}</p>
		{/if}
	{/if}
</main>
