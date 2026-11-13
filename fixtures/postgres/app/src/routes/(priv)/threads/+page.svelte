<script lang="ts">
  import { enhance } from '$app/forms'
  import { page } from '$app/state'
  let { data, form } = $props()
</script>

<h1>PostgreSQL threads</h1>
<p id="thread-route">{page.route.id}</p>
<p id="thread-filter">{data.search}</p>
<ul id="threads">{#each data.threads as thread (thread.id)}<li>{thread.title}</li>{/each}</ul>
<form id="add-thread" method="POST" action="?/add" use:enhance>
  <input id="thread-title" name="title" aria-label="Thread title" />
  <button>Add thread</button>
</form>
{#if form?.fieldErrors}<p id="thread-validation">{form.fieldErrors.title}</p>{/if}
