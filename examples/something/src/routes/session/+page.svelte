<script lang="ts">
let { user = 'guest', via = 'locals' }: { user?: string; via?: string } = $props()
</script>

<main>
	<h1>session (locals + cookies + redirect)</h1>
	<p>user {user} via {via}</p>
	<form method="post" action="/session">
		<input name="payload" value="alice">
		<button type="submit">Login (sets sess cookie)</button>
	</form>
	<form method="post" action="/session?logout">
		<button type="submit">Logout (deletes sess)</button>
	</form>
	<form method="post" action="/session?go">
		<button type="submit">go (?go 303 to /router — POST redirect, GET has no verb arm)</button>
	</form>
</main>
