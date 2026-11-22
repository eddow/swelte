import { tv, type VariantProps } from 'tailwind-variants'

// docvia renders plain tags with no per-element class hook, so prose is styled from the root.
export const markdown = tv({
	base: [
		'flex min-w-0 flex-col leading-relaxed [overflow-wrap:anywhere]',
		'[&_:is(h1,h2,h3,h4,h5,h6)]:font-heading [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-foreground [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-tight',
		'[&_strong]:font-semibold [&_strong]:text-foreground [&_del]:opacity-70',
		'[&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground',
		'[&_ol]:list-decimal [&_ul]:list-disc [&_:is(ul,ol)]:pl-5 [&_li+li]:mt-1 [&_li>:is(ul,ol)]:mt-1 [&_li::marker]:text-muted-foreground',
		'[&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_hr]:border-border',
		'[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.875em] [&_:not(pre)>code]:text-foreground',
		'[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-card [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-foreground',
		'[&_table]:w-full [&_table]:border-collapse [&_:is(th,td)]:border-border/60 [&_:is(th,td)]:border-b [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1.5 [&_:is(th,td)]:text-left [&_th]:font-medium [&_th]:text-foreground',
		'[&_img]:rounded-lg [&_input]:mr-1.5 [&_input]:align-middle',
	],
	variants: {
		variant: {
			default: 'text-foreground',
			muted: 'text-muted-foreground',
		},
		size: {
			sm: 'gap-2 text-xs [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:text-xs',
			default: 'gap-3 text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_pre]:text-sm',
			lg: 'gap-4 text-base [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_pre]:text-sm',
		},
	},
	defaultVariants: { variant: 'default', size: 'default' },
})

export type MarkdownVariant = NonNullable<VariantProps<typeof markdown>['variant']>
export type MarkdownSize = NonNullable<VariantProps<typeof markdown>['size']>
