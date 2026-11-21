<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "#lib/cn.js";
import { type MessageAlign, type MessageMotion, message } from "./variants";

let {
	children,
	class: classProp,
	align = "start",
	animated = true,
	motion = "spring",
	...rest
}: {
	children?: Snippet;
	class?: string;
	/** Which side the message belongs to. `end` reads as sent (row reversed, entrance from
	 * the right); `start` reads as received (entrance from the left). */
	align?: MessageAlign;
	/** Play the entrance. Set false for history already on screen, so only newly arriving
	 * messages animate. */
	animated?: boolean;
	motion?: MessageMotion;
} & HTMLAttributes<HTMLElement> = $props();

const enter = $derived(animated && motion !== "none");
const entranceClass = $derived(
	enter
		? motion === "fade"
			? "fade-in"
			: align === "end"
				? "message-spring-end"
				: "message-spring-start"
		: undefined,
);
</script>

<article
	{...rest}
	data-slot="message"
	data-align={align}
	class={cn(message({ align, motion }), entranceClass, classProp)}
>
	{@render children?.()}
</article>
