<script lang="ts">
import type { Snippet } from 'svelte'

let { children }: { children?: Snippet } = $props()
</script>

<nav data-wrapper="bare-sub">bare-sub wrapper</nav>
<main>
	{@render children?.()}
</main>
