<script lang="ts">
import type { HTMLAttributes } from 'svelte/elements'
import { cn } from '#lib/cn.js'

let { class: classProp, ...rest }: { class?: string } & HTMLAttributes<HTMLSpanElement> = $props()
</script>

<span
	{...rest}
	role="status"
	data-slot="message-typing"
	class={cn('flex items-center gap-1 py-1', classProp)}
>
	<span class="sr-only">Thinking</span>
	{#each [0, 1, 2] as dot (dot)}
		<span
			class="typing-dot size-1.5 rounded-full bg-current opacity-40"
			style:animation-delay="{dot * 160}ms"
		></span>
	{/each}
</span>
