<script lang="ts">
import HoverCard from "#lib/components/ui/hover-card/hover-card.svelte";
import HoverCardContent from "#lib/components/ui/hover-card/hover-card-content.svelte";
import HoverCardTrigger from "#lib/components/ui/hover-card/hover-card-trigger.svelte";
import { cn } from "#lib/cn.js";
import { type ToolChipsSize, toolChips } from "./variants";
import type { ToolChipsLabels, ToolDiff, ToolStep } from "./types";

let {
	steps,
	diffs = [],
	hiddenDiffCount = 0,
	labels,
	size = "default",
	open = $bindable(true),
	onToggleRow,
	class: classProp,
}: {
	steps: ToolStep[];
	diffs?: ToolDiff[];
	hiddenDiffCount?: number;
	labels?: ToolChipsLabels;
	size?: ToolChipsSize;
	open?: boolean;
	onToggleRow?: (label: string, open: boolean) => void;
	class?: string;
} = $props();

let openRows = $state<Set<string>>(new Set());

const classes = $derived(toolChips({ size }));
const header = $derived(
	labels?.header ?? `${steps.length} tool call${steps.length === 1 ? "" : "s"}`,
);

function toggleRow(label: string) {
	const next = new Set(openRows);
	if (next.has(label)) next.delete(label);
	else next.add(label);
	openRows = next;
	onToggleRow?.(label, next.has(label));
}
</script>

{#snippet dotIcon()}
	<span aria-hidden="true" class="size-1.5 rounded-full bg-current"></span>
{/snippet}

<div data-slot="tool-chips" class={cn(classes.root(), classProp)}>
	<button
		type="button"
		aria-expanded={open}
		onclick={() => (open = !open)}
		class="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground transition-colors duration-(--duration-instant) hover:bg-accent"
	>
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class="transition-transform duration-(--duration-base)"
			style:transform={open ? "rotate(0deg)" : "rotate(-90deg)"}
		>
			<path d="M6 9l6 6 6-6" />
		</svg>
		<span class="tabular-nums">{header}</span>
	</button>

	<div
		class="grid transition-[grid-template-rows,opacity] duration-(--duration-slow)"
		style:grid-template-rows={open ? "1fr" : "0fr"}
		style:opacity={open ? 1 : 0}
	>
		<div class="-mx-1 overflow-hidden px-1.5 pb-1">
			<div class="mt-1.5 flex flex-col gap-1">
				{#each steps as row, index (row.label)}
					{@const rowOpen = openRows.has(row.label)}
					<div class="card-fade-up" style="animation-delay: calc(var(--stagger-step) * {index});">
						<button
							type="button"
							aria-expanded={rowOpen}
							onclick={() => toggleRow(row.label)}
							class="group/row -mx-[3px] flex h-7 outline-none focus-visible:ring-2 focus-visible:ring-ring w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-md px-[3px] text-left transition-colors duration-(--duration-instant) hover:bg-accent"
						>
							<span class="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
								<span
									aria-hidden="true"
									class={cn(
										"transition-opacity duration-(--duration-instant) group-hover/row:opacity-0",
										rowOpen && "opacity-0",
									)}
								>
									{#if row.icon}
										{@render row.icon()}
									{:else}
										{@render dotIcon()}
									{/if}
								</span>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									class={cn(
										"absolute transition-[opacity,transform] duration-(--duration-fast) group-hover/row:opacity-100",
										rowOpen ? "opacity-100" : "opacity-0",
									)}
									style:transform={rowOpen ? "rotate(0deg)" : "rotate(-90deg)"}
								>
									<path d="M6 9l6 6 6-6" />
								</svg>
							</span>
							<span class="shrink-0 font-medium text-xs text-foreground">{row.label}</span>
							<span
								class={cn(
									"inline-flex h-5.5 min-w-0 flex-1 cursor-pointer items-center truncate rounded-full bg-muted px-1.5 text-xs text-muted-foreground shadow-xs transition-colors duration-(--duration-instant) hover:bg-accent",
									row.mono && "font-mono",
								)}
							>
								{row.chip}
							</span>
						</button>

						<div
							class="grid transition-[grid-template-rows,opacity] duration-(--duration-slow) ease-[var(--ease-ui-out)]"
							style:grid-template-rows={rowOpen ? "1fr" : "0fr"}
							style:opacity={rowOpen ? 1 : 0}
						>
							<div class="min-h-0 overflow-hidden">
								<div class="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-border/60 border-l py-0.5 pl-3.5">
									{#each row.detail as line (line.text)}
										<span
											class={cn(
												"truncate text-xs leading-[1.6]",
												row.detailMono && "font-mono",
												line.tone === "add" ? "text-success-strong" : "text-muted-foreground",
											)}
										>
											{line.text}
										</span>
									{/each}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>

			{#if diffs.length > 0}
				<div class="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-border/60 border-t pt-2.5">
					{#each diffs as diff, index (diff.file)}
						<HoverCard>
							<HoverCardTrigger
								aria-label={`Show diff for ${diff.file}`}
								class="card-fade-up inline-flex h-7 max-w-full items-center gap-2 rounded-full bg-card px-2 font-mono text-xs text-foreground shadow-sm transition-colors duration-(--duration-instant) hover:bg-accent"
								style="animation-delay: calc(var(--stagger-step) * {steps.length + index});"
							>
								<span class="min-w-0 truncate">{diff.file}</span>
								<span class="shrink-0 text-success-strong tabular-nums">+{diff.add}</span>
								{#if diff.del > 0}
									<span class="shrink-0 text-destructive-strong tabular-nums">−{diff.del}</span>
								{/if}
							</HoverCardTrigger>
							{#if diff.lines?.length}
								<HoverCardContent
									align="start"
									class="w-72 overflow-hidden rounded-[10px] border-none p-0 shadow-2xl"
								>
									<div class="flex items-center justify-between border-border/60 border-b px-2.5 py-1.5 font-mono text-xs">
										<span class="min-w-0 truncate text-muted-foreground">{diff.file}</span>
										<span class="shrink-0 tabular-nums">
											<span class="text-success-strong">+{diff.add}</span>
											{#if diff.del > 0}
												<span class="text-destructive-strong"> −{diff.del}</span>
											{/if}
										</span>
									</div>
									<div class="py-1 font-mono text-xs leading-[1.8]">
										{#each diff.lines as line, lineIndex (lineIndex)}
											<div
												class={cn(
													"flex gap-2 whitespace-pre px-2.5",
													line.tone === "add"
														? "bg-success/10 text-success-strong"
														: line.tone === "del"
															? "bg-destructive/10 text-destructive-strong"
															: "text-muted-foreground",
												)}
											>
												<span class="w-3 shrink-0 select-none"
													>{line.tone === "add" ? "+" : line.tone === "del" ? "−" : " "}</span
												>
												<span class="min-w-0 truncate">{line.text}</span>
											</div>
										{/each}
									</div>
								</HoverCardContent>
							{/if}
						</HoverCard>
					{/each}
					{#if hiddenDiffCount > 0}
						<span class="inline-flex h-7 items-center rounded-full px-1.5 font-mono text-xs text-muted-foreground">
							+{hiddenDiffCount} more
						</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
