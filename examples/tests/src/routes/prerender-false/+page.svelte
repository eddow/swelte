<script lang="ts">
let { greeting = 'none' }: { greeting?: string } = $props()
</script>
<main>
	<h1>prerender-false</h1>
	<p>server: {greeting}</p>
</main>
