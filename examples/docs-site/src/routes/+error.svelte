<script lang="ts">
	let { status = 500, message = 'Something went wrong' }: { status?: number; message?: string } =
		$props();
</script>

<div class="hero min-h-[50vh]">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h1 class="text-6xl font-bold">{status}</h1>
			<p class="py-6">{message}</p>
			<a href="/" class="btn btn-primary">Back home</a>
		</div>
	</div>
</div>
