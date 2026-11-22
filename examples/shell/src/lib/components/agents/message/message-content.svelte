<script lang="ts">
import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { cn } from '#lib/cn.js'

let {
	children,
	class: classProp,
	...rest
}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<div
	{...rest}
	data-slot="message-content"
	class={cn(
		'flex w-full min-w-0 flex-col gap-2 wrap-break-word group-data-[align=end]/message:*:data-[slot]:self-end',
		classProp
	)}
>
	{@render children?.()}
</div>
