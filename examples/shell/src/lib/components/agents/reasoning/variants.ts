import { tv, type VariantProps } from 'tailwind-variants'

export const reasoning = tv({
	slots: {
		root: 'w-full overflow-hidden rounded-xl',
		trigger:
			'group/trigger flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-[background-color,scale] duration-(--duration-press) ease-(--ease-ui-out) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-(--press-scale) motion-reduce:transition-none',
		icon: 'mt-0.5 size-3.5 shrink-0 text-muted-foreground',
		heading: 'min-w-0 flex-1',
		titleRow: 'flex items-baseline gap-1.5',
		title: 'font-medium text-muted-foreground',
		titleThinking: 'reasoning-shimmer font-medium',
		duration: 'text-muted-foreground text-xs tabular-nums',
		preview: 'mt-0.5 block truncate text-muted-foreground text-xs',
		chevron:
			'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-dropdown) ease-(--ease-ui-out) group-data-[panel-open]/trigger:rotate-180 group-data-[state=open]/trigger:rotate-180 motion-reduce:transition-none',
		panel:
			'grid grid-rows-[0fr] transition-[grid-template-rows] duration-(--duration-dropdown) ease-(--ease-ui-out) data-[open]:grid-rows-[1fr] data-[state=open]:grid-rows-[1fr] motion-reduce:transition-none',
		clip: 'overflow-hidden',
		content: 'px-3 pt-1 pb-2.5 text-muted-foreground text-xs leading-relaxed',
	},
	variants: {
		variant: {
			outline: {
				root: 'border border-border bg-card/40',
				content: 'border-border/60 border-t pt-2.5',
			},
			card: { root: 'rounded-2xl bg-card' },
			// No chrome: a compact header over a thread line, for inline chat transcripts.
			inline: {
				root: 'max-w-sm overflow-visible rounded-none',
				trigger: '-mx-1.5 w-fit items-center rounded-md px-1.5 py-1',
				icon: 'mt-0',
				chevron: 'mt-0',
				content: 'mt-1 ml-[5px] border-border/60 border-l px-0 pt-1 pb-1 pl-4',
			},
		},
	},
	defaultVariants: { variant: 'outline' },
})

export type ReasoningVariant = NonNullable<VariantProps<typeof reasoning>['variant']>

export const reasoningStep = tv({
	slots: {
		list: 'flex flex-col [&>li:last-child_[data-slot=reasoning-step-connector]]:hidden',
		item: 'reasoning-step-in grid grid-rows-[1fr]',
		clip: 'overflow-hidden',
		row: 'flex gap-3 pb-3',
		rail: 'flex flex-col items-center',
		glyphBox: 'flex h-5 items-center justify-center',
		glyph: 'pop-in flex size-3 items-center justify-center',
		connector: 'my-1 w-px flex-1 rounded-full transition-colors duration-500',
		body: 'min-w-0 flex-1',
		label: 'text-sm leading-5 transition-colors duration-(--duration-slow)',
		description: 'mt-0.5 text-muted-foreground text-xs leading-5',
	},
	variants: {
		status: {
			pending: { item: 'hidden' },
			active: {
				glyph: 'after:size-1.5 after:rounded-full after:bg-foreground',
				connector: 'bg-foreground/10',
				label: 'font-medium text-foreground',
			},
			done: { connector: 'bg-foreground/25', label: 'text-foreground/80' },
		},
	},
	defaultVariants: { status: 'done' },
})

/** Pending steps render nothing until they turn active or done. */
export type ReasoningStepStatus = NonNullable<VariantProps<typeof reasoningStep>['status']>

export const reasoningExtras = tv({
	slots: {
		detailsTrigger: 'mt-1 w-auto px-0 py-0.5 font-normal text-muted-foreground text-xs',
		detailsContent: 'flex flex-col gap-1 px-0 pb-0.5 text-muted-foreground text-xs leading-5',
		sources: 'mt-2 flex flex-wrap gap-1.5',
		sourceLink:
			'rounded-full transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
		source: 'pop-in rounded-full text-foreground/70',
		figure: 'pop-in mt-2',
		image: 'w-full max-w-[220px] rounded-lg object-cover',
		caption: 'mt-1 text-xs text-muted-foreground',
	},
})

export const reasoningRows = tv({
	slots: {
		list: 'flex flex-col gap-1',
		query: 'flex h-6 items-center gap-2 px-1.5 text-muted-foreground text-xs',
		row: 'card-fade-up flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left',
		label: 'min-w-0 truncate font-medium text-foreground text-xs',
		secondary: 'shrink-0 text-muted-foreground text-xs',
		diff: 'shrink-0 font-mono text-xs tabular-nums',
		glyph: 'size-3.5 shrink-0 text-muted-foreground',
		spinner:
			'spinner size-3 shrink-0 rounded-full border-[1.5px] border-border border-t-muted-foreground',
		source: 'flex size-3.5 shrink-0 items-center justify-center rounded-full text-white',
	},
	variants: {
		/** Steps tick off or spin; search rows link out to sources; coding rows select a file. */
		kind: {
			steps: {},
			search: {
				row: 'transition-colors duration-(--duration-fast) hover:bg-accent',
			},
			coding: {
				row: 'transition-colors duration-(--duration-fast) hover:bg-accent aria-pressed:bg-muted',
			},
		},
	},
	defaultVariants: { kind: 'steps' },
})

export type ReasoningRowsKind = NonNullable<VariantProps<typeof reasoningRows>['kind']>

export type ReasoningRow = {
	primary: string
	secondary?: string
	/** Sets `secondary` in the mono face, e.g. a path. */
	mono?: boolean
	/** Coding rows: lines added and removed. */
	add?: number
	del?: number
	/** Search rows: the source URL. */
	href?: string
	/** Steps rows: spins instead of ticking. */
	status?: 'active'
}

/** Search source dot colours, cycled per row. */
export const SOURCE_TONES = ['bg-info', 'bg-warning', 'bg-success'] as const
