<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "#lib/cn.js";

// overflow-x-clip (not hidden) swallows a row's sideways entrance travel without
// creating a scroll container.
let {
	children,
	class: classProp,
	...rest
}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} data-slot="message-group" class={cn("flex min-w-0 flex-col gap-2 overflow-x-clip", classProp)}>
	{@render children?.()}
</div>
