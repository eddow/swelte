<script lang="ts">
import { cn } from '#lib/cn.js'
import { type ReasoningRow, type ReasoningRowsKind, reasoningRows, SOURCE_TONES } from './variants'

let {
	rows,
	kind = 'steps',
	query,
	value = $bindable(),
	defaultValue = null,
	onValueChange,
	class: classProp,
}: {
	rows: readonly ReasoningRow[]
	kind?: ReasoningRowsKind
	/** Search: the query shown above the sources. */
	query?: string
	/** Coding: the selected row's `primary`. Bindable. */
	value?: string | null
	defaultValue?: string | null
	onValueChange?: (value: string | null) => void
	class?: string
} = $props()

const s = $derived(reasoningRows({ kind }))
const selected = $derived(value === undefined ? defaultValue : value)

function pick(next: string | null) {
	value = next
	onValueChange?.(next)
}
</script>

{#snippet content(r: ReasoningRow, i: number)}
	{#if kind === 'search'}
		<span class={cn(s.source(), SOURCE_TONES[i % SOURCE_TONES.length])}>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				aria-hidden="true"
				class="size-2.5"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
			</svg>
		</span>
	{:else if kind === 'steps'}
		{#if r.status === 'active'}
			<span aria-hidden="true" class={s.spinner()}></span>
		{:else}
			<svg
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				class={s.glyph()}
			>
				<path d="M3.5 8.4 6.4 11 12.5 4.5" />
			</svg>
		{/if}
	{/if}
	<span class={s.label()}>{r.primary}</span>
	{#if r.secondary}
		<span class={cn(s.secondary(), r.mono && 'font-mono')}>{r.secondary}</span>
	{/if}
	{#if r.add !== undefined}
		<span class={s.diff()}>
			<span class="text-success-strong">+{r.add}</span>
			<span class="text-destructive-strong">-{r.del ?? 0}</span>
		</span>
	{/if}
{/snippet}

<!-- Trace rows for a Reasoning panel: ticking steps, linked search sources or selectable files. -->
<div data-slot="reasoning-rows" class={cn(s.list(), classProp)}>
	{#if query}
		<div class={s.query()}>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
				class={s.glyph()}
			>
				<circle cx="11" cy="11" r="7" />
				<path d="M21 21l-4.3-4.3" />
			</svg>
			{query}
		</div>
	{/if}
	{#each rows as r, i (`${i}-${r.primary}`)}
		{#if kind === 'search'}
			<a
				href={r.href}
				target="_blank"
				rel="noreferrer"
				style="animation-delay: {i * 80}ms"
				class={s.row()}
			>
				{@render content(r, i)}
			</a>
		{:else if kind === 'coding'}
			<button
				type="button"
				aria-pressed={selected === r.primary}
				onclick={() => pick(selected === r.primary ? null : r.primary)}
				style="animation-delay: {i * 80}ms"
				class={s.row()}
			>
				{@render content(r, i)}
			</button>
		{:else}
			<div style="animation-delay: {i * 80}ms" class={s.row()}>{@render content(r, i)}</div>
		{/if}
	{/each}
</div>
