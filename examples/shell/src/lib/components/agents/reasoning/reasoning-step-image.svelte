<script lang="ts">
import { cn } from '#lib/cn.js'
import { reasoningExtras } from './variants'

let {
	src,
	alt = '',
	caption,
	class: classProp,
}: { src: string; alt?: string; caption?: string; class?: string } = $props()

const styles = reasoningExtras()
</script>

<figure class={cn(styles.figure(), classProp)}>
	<img {src} {alt} width="220" height="140" class={styles.image()}>
	{#if caption}
		<figcaption class={styles.caption()}>{caption}</figcaption>
	{/if}
</figure>
