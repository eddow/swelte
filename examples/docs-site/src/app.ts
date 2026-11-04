// Optional user setup — auto-imported by the generated
// .swelte/entry-main.ts (plus src/app.css when present).
//
// Re-applies the stored/OS theme on client boot (SPA navigations, HMR).
// First paint is handled by the inline blocking script in index.html —
// type="module" here is deferred, so this alone would flash. Client-only:
// `src/app.ts` is not part of the SSR bundle, so the `document` access
// below can never run in the QuickJS server render.
// See `src/lib/theme.ts` for the shared read/apply logic.
import { applyTheme, preferredTheme } from './lib/theme.js'

applyTheme(preferredTheme())
