<script lang="ts">
import Detail from './Detail.svelte'
import { PanelState } from './state.svelte.js'
let { message }: { message: string } = $props()
const state = new PanelState()
</script>

<section aria-label="Native package">
	<p>{message}</p>
	<button onclick={() => (state.expanded = !state.expanded)} aria-expanded={state.expanded}>
		Details
	</button>
	<Detail expanded={state.expanded} />
</section>
