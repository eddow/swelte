<script lang="ts">
import { enhance, page } from '@swelte/core'

// Item 15a: plain <form method=post use:enhance> — no reload, page.form
// publishes the JSON payload, form resets.
let formEl: HTMLFormElement | undefined = $state(undefined)
let status = $state('idle')
</script>

<main>
	<h1>enhance (item 15a)</h1>
	<form
		method="post"
		action="/router/enhance?echo"
		use:enhance
		bind:this={formEl}
		onsubmit={() => (status = 'submitted')}
	>
		<input name="payload" value="alice">
		<button type="submit">Send enhanced</button>
	</form>
	<p data-testid="enhance-status">{status}</p>
	{#if $page.form}
		<p data-testid="enhance-form">form: {JSON.stringify($page.form)}</p>
	{/if}
</main>
