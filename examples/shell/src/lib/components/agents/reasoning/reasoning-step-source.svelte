<script lang="ts">
import type { Snippet } from 'svelte'
import Badge from '#lib/components/ui/badge/badge.svelte'
import { cn } from '#lib/cn.js'
import { reasoningExtras } from './variants'

let {
	children,
	href,
	class: classProp,
}: {
	children?: Snippet
	/** Opens in a new tab when set. */
	href?: string
	class?: string
} = $props()

const styles = reasoningExtras()
</script>

{#snippet pill()}
	<Badge variant="outline" size="sm" class={cn(styles.source(), classProp)}>
		{@render children?.()}
	</Badge>
{/snippet}

{#if href}
	<a {href} target="_blank" rel="noreferrer noopener" class={styles.sourceLink()}>
		{@render pill()}
	</a>
{:else}
	{@render pill()}
{/if}
