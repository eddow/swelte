<script lang="ts">
import { setContext } from 'svelte'
import { page } from '$app/state'
let { data, children } = $props()
setContext('dogfood-layout', 'inherited context')
</script>

<svelte:head><meta name="dogfood-locale" content={data.locale}></svelte:head>
<nav id="layout-locale">{data.locale}:{page.url.searchParams.get('q') ?? ''}</nav>
{@render children()}
