<script lang="ts">
let { data }: { data?: string } = $props()
</script>

<main>
	<h1>__NAME__</h1>
	{#if data}
		<p>{data}</p>
	{:else}
		<p>Empty Swelte project. Add routes in <code>src/routes/</code>.</p>
	{/if}
</main>
