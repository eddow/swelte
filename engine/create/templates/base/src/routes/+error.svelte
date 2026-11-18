<script lang="ts">
let { status = 500, message = 'Something went wrong' }: { status?: number; message?: string } =
	$props()
</script>

<main>
	<h1>{status}</h1>
	<p>{message}</p>
	{#if status === 400 || status === 401 || status === 403}
		<p><a href="/login">Log in</a> · <a href="/">Home</a></p>
	{:else}
		<p><a href="/">Home</a></p>
	{/if}
</main>
