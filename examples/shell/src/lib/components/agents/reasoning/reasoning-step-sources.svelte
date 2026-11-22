<script lang="ts">
import type { Snippet } from 'svelte'
import { cn } from '#lib/cn.js'
import { reasoningExtras } from './variants'

let { children, class: classProp }: { children?: Snippet; class?: string } = $props()
</script>

<div class={cn(reasoningExtras().sources(), classProp)}>{@render children?.()}</div>
