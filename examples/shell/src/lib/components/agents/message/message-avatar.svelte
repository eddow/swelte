<script lang="ts">
import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { cn } from '#lib/cn.js'

// A styled slot, not an image component: pass your own <img>/AvatarFallback/icon as
// children. Lifts clear of a footer line when one is present in the same message.
let {
	children,
	class: classProp,
	...rest
}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<div
	{...rest}
	data-slot="message-avatar"
	class={cn(
		'flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted transition-transform duration-(--duration-slow) ease-[var(--ease-ui-out)] group-has-data-[slot=message-footer]/message:-translate-y-8 motion-reduce:transition-none',
		classProp
	)}
>
	{@render children?.()}
</div>
