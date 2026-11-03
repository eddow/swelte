<script lang="ts">
import type { Snippet } from 'svelte'

let { children }: { children?: Snippet } = $props()
</script>

<nav><a href="/">home</a> · session</nav>
<main>
	{@render children?.()}
</main>
