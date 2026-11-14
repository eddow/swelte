<script lang="ts">
  import { page } from '$app/state'
  let { data } = $props()
</script>

<svelte:head><title>Item {data.id}</title></svelte:head>
<p id="item">{data.id}:{data.search}:{data.locale}</p>
<p id="item-route">{page.route.id}</p>
<p id="item-param">{page.params.id}</p>
