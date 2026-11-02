<script lang="ts">
let { status = 500, message = 'Something went wrong' }: { status?: number; message?: string } = $props()
</script>
<main>
  <h1>{status}</h1>
  <p>{message}</p>
  <p><a href="/">Home</a></p>
</main>
