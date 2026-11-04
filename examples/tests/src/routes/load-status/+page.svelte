<script lang="ts">
let { dummy = 'none' }: { dummy?: string } = $props()
</script>
<main>
	<h1>load-status</h1>
	<p>{dummy}</p>
</main>
