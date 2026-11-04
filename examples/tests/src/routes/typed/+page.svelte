<script lang="ts">
let { dummy = 'none' }: { dummy?: string } = $props()
</script>
<main>
	<h1>typed</h1>
	<p>{dummy}</p>
</main>
