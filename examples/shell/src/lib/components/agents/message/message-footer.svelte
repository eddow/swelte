<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "#lib/cn.js";

let {
	children,
	class: classProp,
	...rest
}: { children?: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	{...rest}
	data-slot="message-footer"
	class={cn(
		"flex min-w-0 max-w-full items-center px-3 font-medium text-muted-foreground text-xs group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
		classProp,
	)}
>
	{@render children?.()}
</div>
