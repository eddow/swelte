<script lang="ts">
let { user = 'guest', via = 'locals' }: { user?: string; via?: string } = $props()
</script>

<main>
	<h1>session (locals + cookies + redirect)</h1>
	<p>user {user} via {via}</p>
	<form method="post" action="/session">
		<input name="payload" value="alice" />
		<button type="submit">Login (sets sess cookie)</button>
	</form>
	<form method="post" action="/session?logout">
		<button type="submit">Logout (deletes sess)</button>
	</form>
	<p><a href="/session?go">go (?go 303 to /router)</a></p>
</main>
