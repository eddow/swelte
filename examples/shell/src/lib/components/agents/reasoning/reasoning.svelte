<script lang="ts">
import { Collapsible as CollapsiblePrimitive } from 'bits-ui'
import { type Snippet, untrack } from 'svelte'
import { cn } from '#lib/cn.js'
import { type ReasoningVariant, reasoning } from './variants'
import { type ActiveStep, setReasoningContext } from './context'

let {
	children,
	thinking = false,
	duration = 0,
	open = $bindable(),
	defaultOpen = false,
	onOpenChange,
	variant = 'outline',
	thinkingLabel = 'Thinking',
	formatDuration = (seconds: number) => `Thought for ${seconds}s`,
	class: classProp,
}: {
	children?: Snippet
	/** Model is still reasoning: the title shimmers and the panel auto-opens. */
	thinking?: boolean
	/** Seconds spent reasoning, passed in by the caller. */
	duration?: number
	/** Controlled open state. Omit to open while thinking and close when done. */
	open?: boolean
	defaultOpen?: boolean
	onOpenChange?: (open: boolean) => void
	variant?: ReasoningVariant
	/** Title while thinking. */
	thinkingLabel?: string
	/** Title once done, from the duration in seconds. */
	formatDuration?: (seconds: number) => string
	class?: string
} = $props()

let touched = $state(false)
let manual = $state(untrack(() => defaultOpen))
let active = $state<ActiveStep | null>(null)
// Auto-open while thinking, auto-close when it ends, unless the reader has chosen.
const isOpen = $derived(open ?? (touched ? manual : thinking || defaultOpen))
const styles = $derived(reasoning({ variant }))
const preview = $derived(thinking && !isOpen ? active : null)

setReasoningContext({
	setActive(step, id) {
		active = step ? step : active?.id === id ? null : active
	},
})

function setOpen(next: boolean) {
	touched = true
	manual = next
	if (open !== undefined) open = next
	onOpenChange?.(next)
}
</script>

<CollapsiblePrimitive.Root
	data-slot="reasoning"
	bind:open={() => isOpen, setOpen}
	class={cn(styles.root(), classProp)}
>
	<CollapsiblePrimitive.Trigger data-slot="reasoning-trigger" class={styles.trigger()}>
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class={styles.icon()}>
			<path
				d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.4.3.6.7.6 1.2v.3h3.6v-.3c0-.5.2-.9.6-1.2A4.2 4.2 0 0 0 8 1.8Z"
				stroke="currentColor"
				stroke-width="1.2"
			/>
			<path d="M6.4 13.4h3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
		</svg>
		<span class={styles.heading()}>
			<span class={styles.titleRow()}>
				<span class={thinking ? styles.titleThinking() : styles.title()}
					>{thinking ? thinkingLabel : formatDuration(duration)}</span
				>
				{#if thinking && duration > 0}
					<span class={styles.duration()}>{duration}s</span>
				{/if}
			</span>
			{#if preview}
				{#key preview.id}
					<span
						class={cn(styles.preview(), 'text-transition-unit')}
						style="--tt-duration: 220ms; --tt-from-opacity: 0; --tt-from-y: 8px; --tt-from-blur: 3px;"
						>{preview.label}</span
					>
				{/key}
			{/if}
		</span>
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class={styles.chevron()}>
			<path
				d="m4 6 4 4 4-4"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</CollapsiblePrimitive.Trigger>
	<!-- forceMount keeps a closed frame for the grid-rows transition to animate from. -->
	<CollapsiblePrimitive.Content forceMount data-slot="reasoning-content" class={styles.panel()}>
		<div class={styles.clip()}>
			<div class={styles.content()}>{@render children?.()}</div>
		</div>
	</CollapsiblePrimitive.Content>
</CollapsiblePrimitive.Root>
