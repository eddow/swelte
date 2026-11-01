<script lang="ts">
let { status = 200, message = 'boom page' }: { status?: number; message?: string } = $props()
</script>

<main>
	<h1>boom</h1>
	<p>{status}: {message}</p>
</main>
