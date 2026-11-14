<script lang="ts">
  import Panel from '@swelte-dogfood/sample-lib/Panel.svelte'
  import { getContext } from 'svelte'
  import { enhance } from '$app/forms'
  import { page } from '$app/state'
  import { invalidate } from '$app/navigation'
  let { data, form } = $props()
  // svelte-ignore state_referenced_locally
  if (data.search === 'render-fail') throw new Error('private renderer failure')
  const context = getContext<string>('dogfood-layout')
  let draft = $state('unsent')
  let count = $state(0)
  let refreshes = $state(0)
  let crossDone = $state(false)
</script>

<svelte:head><title>Native package dogfood</title>{#if data.headProof}<meta name="head-proof" content={data.headProof} />{/if}</svelte:head>
{#if data.oversized}<p>{data.oversized}</p>{/if}
<h1>Installed native library</h1>
<Panel message={data.message} />
<p id="context">{context}</p>
<p id="search">{data.search}</p>
<p id="universal">{data.viewProof}</p>
<p id="route">{page.route.id}</p>
<button id="local" onclick={() => count++}>Local {count}</button>
<button id="invalidate" onclick={async () => { await invalidate('dogfood:home'); refreshes++ }}>Refresh tagged load</button>
<span id="refreshes">{refreshes}</span>
<input id="draft" bind:value={draft} aria-label="Unsent draft" />
<a id="query-link" href="/?q=next&lang=fr">Next query</a>
<form id="save" method="POST" action="?/save" use:enhance={() => async ({ update }) => { await update({ reset: false }) }}>
  <input id="title" name="title" aria-label="Title" />
  <input id="attachment" name="attachment" type="file" aria-label="Attachment" />
  <button id="submit">Save</button>
  <button id="upload" formaction="?/upload" formenctype="multipart/form-data">Upload</button>
</form>
<form id="cross-page" method="POST" action="/actions?/save" use:enhance={() => async ({ update }) => { await update(); crossDone = true }}>
  <input name="title" value="cross-page" />
  <button>Save elsewhere</button>
</form>
<span id="cross-done">{crossDone}</span>
{#if form?.fieldErrors}<p id="validation">{form.fieldErrors.title}</p>{/if}
{#if form?.saved}<p id="saved">Saved</p>{/if}
{#if form?.uploaded}<p id="uploaded">Uploaded</p>{/if}
{#if form?.unrelated}<p id="unrelated">Unrelated result</p>{/if}
