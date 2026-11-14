<script lang="ts">
import { page } from '$app/state'
let { data } = $props()
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="article-locale" content={data.locale}>
	<link rel="canonical" href={data.canonical}>
</svelte:head>
<h1 id="article">{data.title}</h1>
<p id="article-path">{page.url.pathname}</p>
<p id="article-url">{page.url.href}</p>
