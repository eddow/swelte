<script lang="ts">
import { get_greeting, save_name } from '#routes/+page.v'
let { greeting = 'none' }: { greeting?: string } = $props()
let name = $state('world')
let echo = $state('')
async function loadGreeting() { echo = await get_greeting({ payload: name }) }
async function saveName() { echo = await save_name({ payload: name }) }
</script>
<main>
  <h1>swelte tests</h1>
  <p>server: {greeting}</p>
  <input bind:value={name} placeholder="your name" />
  <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
    <button onclick={loadGreeting}>Greet (#routes GET)</button>
    <button onclick={saveName}>Save (#routes POST)</button>
  </div>
  {#if echo}<p>{echo}</p>{/if}
</main>
