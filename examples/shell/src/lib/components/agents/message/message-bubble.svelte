<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "#lib/cn.js";
import { type MessageBubbleVariant, messageBubble } from "./variants";

let {
	children,
	class: classProp,
	variant = "default",
	...rest
}: {
	children?: Snippet;
	class?: string;
	/** `default` is a muted pill for received messages, `primary` a filled pill for sent
	 * ones, `ghost` drops the pill for bare text like a streamed reply. */
	variant?: MessageBubbleVariant;
} & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} data-slot="message-bubble" data-variant={variant} class={cn(messageBubble({ variant }), classProp)}>
	{@render children?.()}
</div>
