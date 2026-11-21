<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "#lib/cn.js";
import { reasoningStep } from "./variants";

let { children, class: classProp }: { children?: Snippet; class?: string } = $props();
</script>

<ul data-slot="reasoning-steps" class={cn(reasoningStep().list(), classProp)}>
	{@render children?.()}
</ul>
