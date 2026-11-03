<script lang="ts">
	import type { CodeSnippet } from './code.js';

	let {
		snippet,
		title,
		dense = false
	}: {
		snippet: CodeSnippet;
		title?: string;
		dense?: boolean;
	} = $props();
</script>

<div class="swelte-code not-prose rounded-box overflow-hidden border border-base-300 bg-base-100">
	{#if title}
		<div class="px-4 py-1.5 text-xs font-mono opacity-60 border-b border-base-300 bg-base-200">
			{title}
		</div>
	{/if}
	<pre class="shiki overflow-x-auto p-4 font-mono {dense ? 'text-xs' : 'text-sm'} leading-relaxed"><code>{@html snippet.html}</code></pre>
</div>

