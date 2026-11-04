<script lang="ts">
let { greeting = 'none' }: { greeting?: string } = $props()
</script>
<main>
	<h1>prerender-true</h1>
	<p>server: {greeting}</p>
</main>
