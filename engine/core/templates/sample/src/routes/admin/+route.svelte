<script lang="ts">
import type { Snippet } from 'svelte'

let { children }: { children?: Snippet } = $props()
</script>

<nav><a href="/">home</a> · admin</nav>
<main>
	{@render children?.()}
</main>
