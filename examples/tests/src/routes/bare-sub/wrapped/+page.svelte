<script lang="ts">
let { greeting = 'none' }: { greeting?: string } = $props()
</script>
<main>
	<h1>wrapped-sub leaf</h1>
	<p>server: {greeting}</p>
</main>
