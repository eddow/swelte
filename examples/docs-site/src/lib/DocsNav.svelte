<script lang="ts">
let {
	next,
	related = [],
}: {
	next?: { href: string; label: string }
	related?: { href: string; label: string }[]
} = $props()
</script>

{#if next || related.length > 0}
	<nav aria-label="Page navigation" class="flex gap-2 mt-8 flex-wrap border-t border-base-200 pt-6">
		{#if next}
			<a href={next.href} class="btn btn-primary btn-sm">Next: {next.label}</a>
		{/if}
		{#each related as r}
			<a href={r.href} class="btn btn-ghost btn-sm">{r.label}</a>
		{/each}
	</nav>
{/if}
