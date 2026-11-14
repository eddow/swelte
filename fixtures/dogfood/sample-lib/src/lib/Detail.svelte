<script lang="ts">
let { expanded }: { expanded: boolean } = $props()
</script>

{#if expanded}
	<p>Shared Svelte UI from an installed package</p>
{/if}
