<script lang="ts">
import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { cn } from '#lib/cn.js'
import { messageMarker } from './variants'

let {
	children,
	class: classProp,
	...rest
}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<!-- A centred note in the thread, such as a date or "Conversation resumed". -->
<div {...rest} data-slot="message-marker" class={cn(messageMarker(), classProp)}>
	{@render children?.()}
</div>
