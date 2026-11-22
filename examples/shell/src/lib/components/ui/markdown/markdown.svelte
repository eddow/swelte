<script lang="ts">
import { Markdown, StreamingMarkdown } from '@docvia/markdown/svelte'
import { cn } from '#lib/cn.js'
import { type MarkdownAnimate, markdownMotion } from './motion'
import { type MarkdownSize, type MarkdownVariant, markdown } from './variants'

let {
	content,
	variant = 'default',
	size = 'default',
	streaming,
	animate = 'fade',
	caret = true,
	class: classProp,
}: {
	/** Markdown source; while streaming, the whole text so far. */
	content: string
	variant?: MarkdownVariant
	size?: MarkdownSize
	/** `true` while chunks arrive, `false` once done. Unset renders static text on the server. */
	streaming?: boolean
	/** Word entry while streaming: `true` fades, an effect name picks another, `false` is off. */
	animate?: MarkdownAnimate
	/** Blinking caret after the last word while streaming. */
	caret?: boolean
	class?: string
} = $props()
</script>

<div
	data-slot="markdown"
	aria-busy={streaming || undefined}
	class={cn(markdown({ variant, size }), classProp)}
>
	{#if streaming === undefined}
		<Markdown source={content} />
	{:else}
		<StreamingMarkdown source={content} {streaming} animate={markdownMotion(animate)} {caret} />
	{/if}
</div>
