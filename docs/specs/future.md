# Remaining framework work

These are future capabilities, not prerequisites for the completed
[dogfood work](dogfood-roadmap.md).

- **Background ISR regeneration:** current ISR support emits cache headers.
  Implement background rendering and atomic replacement of generated HTML.
- **Native image processing:** add a build-time V pipeline for resizing and
  WebP output, with an explicit asset contract.
- **Offline outbox:** add a persistent replay queue and background-sync behavior
  to the network-first service worker, including retry and failure semantics.
- **Durable scheduled jobs:** Plus cron ticks are best-effort and process-local.
  Persistence, restart catchup and coordination across instances remain open.
- **Nested error boundaries:** SSR currently selects one global `+error.svelte`.
  Per-directory selection and inheritance remain unimplemented.

- **SSR source guard precision:** ignore prose and literal markup when checking
  for forbidden JavaScript. The docs site exposed false positives for the word
  `await` and text displaying `fetch(` outside executable expressions.
