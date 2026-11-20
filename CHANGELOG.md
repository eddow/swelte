## 0.1.6

- add `@swelte/create`: allows `npm create @swelte`
- Refactor cli: remove dedicated `swelte-ssr` and integrate everything in `swelte` CLI through "pluginability"
- `@svelte/vvm` -> `use --system`
- `@svelte/plus` who was supposed to hold all "beyond parity" with sveltekit features (swr/ws/cron/...) ended up containing 3 lines of code and is now integrated in `core`