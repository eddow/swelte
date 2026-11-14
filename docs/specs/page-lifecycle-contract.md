# Page lifecycle and action contract

DF-02 / DF-03 decisions, 2026-11-08. This is the implementation contract for
the dogfooding roadmap, not a claim that the behavior below is already shipped.
Gate 1 implements and validates it before it moves into user documentation.

## Compatibility boundary

Keep the existing flat component props and `@swelte/core` store API available.
Add opt-in `swelte.compat: 'sveltekit'` for migrated components expecting
`{ data, form }`, a reactive `$app/state` object and `$app/forms` adaptation.
Default compatibility mode is off; no existing component silently changes
from flat props to a nested `data` prop. This adapts the required surface only;
it does not imply general SvelteKit server/runtime compatibility.

The canonical reactive page object will also be available as `#app/state`.
Legacy `@swelte/core` page stores and `$app/stores` remain subscribable views of
the same browser lifecycle. `$app/state` retains its legacy store export unless
compatibility is enabled. SSR shims must provide equivalent request-local
values for the selected mode; they must not import browser-global state.

## Request and response paths

All page loading runs the same guarded V cascade. HTML rendering, navigation
and refresh must not duplicate a route's business queries in different handlers.

| Request | Result |
|---|---|
| Normal HTML GET | Guard, load cascade, synchronous universal transforms, SSR and initial state serialization |
| GET with `Accept: application/json` and `X-Swelte-Load: 1` | Guard and the same load cascade; versioned page envelope, no ordinary `@[get]` handler or rendering |
| Ordinary JSON GET | Existing `@[get]` semantics on the same URL |
| Form mutation | Guard and selected verb/action; enhancement applies result and optionally refreshes the current page |
| Binary/stream/socket | Guard before handler or connection takeover; transport-specific body thereafter |

The load header is a protocol selector, never authorization. It introduces no
new `/api` namespace and does not make private data public. Navigation load
responses are private/non-cacheable by default and vary on the protocol selector;
an app's explicit cache policy must account for cookies/authorization and host.

The page envelope has `version: 1`, `url` (absolute URL string),
`route: { id, pattern }`, `params`, `data`, `levels`, `form`, `status`, `error`
and `redirect`. `id` retains disk-only route groups; `pattern` is the matched
URL pattern with groups removed. No physical build paths enter the payload.
The initial server hash is empty; the browser adds its current hash locally.
Request URL reconstruction must follow the application's trusted host/proxy
configuration, not blindly trust arbitrary forwarded headers.

- `levels` identifies each rendered wrapper and leaf, with its data/props.
- `data` is the leaf's merged view, not an unrelated ordinary GET response.
- `form` is initially null except a server-rendered action failure/result.
- `error` and `redirect` are mutually exclusive outcomes, not successful data.
- HTTP status, headers and all cookies remain real response metadata. A load
  redirect additionally carries its location in `redirect` for explicit router
  handling; the load protocol must not silently follow it into a login payload.
- Plain load throws become a failure status, not success with `{}`. Existing
  typed errors retain their status. Unexpected internal details are sanitized.

## Cascade and component props

Keep typed parent parameters in V. Retain each load level's result when building
the envelope; the last result alone cannot describe every wrapper's data.
Load cascading remains independent of which wrappers are selected for rendering.

For compatibility mode, merge object load data shallowly from ancestors to the
current level; deeper keys win. Each wrapper receives its level's merged
`data`, `form` and `children`; the leaf receives `{ data, form }`. Global
`page.data` contains the final merged leaf data before any wrapper executes.
Compatibility loads must return object data (or an object-valued load envelope);
unsupported shapes are diagnosed rather than spread into numeric/string keys.

Default flat mode preserves its existing leaf props shape and last-result
behavior. Wrapper data is supplied consistently at its own level without
changing the leaf's existing field precedence. Universal loads keep their
synchronous `load({ params, props, url })` contract when SSR is on and run in
the corresponding client path too; the URL argument is the actual request URL.
No server fetch/provider work moves into QuickJS.

## SSR, serialization and hydration

Supply page state through a render-local context before creating the wrapper
tree. Render that tree with real snippet/context nesting in one Svelte render
operation, preserving head output. Existing per-render QuickJS isolation stays
in place; no process-global locale/auth state is introduced.

Serialize public initial state into an inert
`<script type="application/json" id="__swelte_page">` element. Escape `<`, `>`,
`&`, U+2028 and U+2029 so values cannot terminate the element or introduce HTML.
Do not serialize locals, secrets, native resources or arbitrary response headers.
Loads remain responsible for returning browser-visible data only.

Browser boot parses/validates the envelope, constructs URL/route state and
hydrates with precisely the same level props. It must not refetch initial data
or hydrate with defaults first. Record hydration fallback as an observable
outcome; strict tests fail on unexpected fallback. Deliberate `csr=false` and
`ssr=false` remain separate outcomes.

## Browser navigation and refresh

Publish a reactive object with `url: URL`, `route: { id, pattern }`, `params`,
`data`, `form`, `status`, `error` and history `state`. The store adapter keeps
its existing string URL/route shape for compatibility. Components consume the
reactive object directly or subscribe through the legacy store; neither reads
the methods of a store as if they were data fields.

Navigation loads before committing new UI/state. Preserve pathname, query and
hash across goto/history; popstate must use the full browser URL. Handle a load
redirect explicitly and publish errors with their status. Avoid publishing a
stale response when a later navigation/refresh has already completed.

Add an awaited router refresh operation that re-runs the current load URL and
updates mounted props without creating a history entry. Preserve component
instances/local state when route and wrapper identity are unchanged. Connect
`invalidateAll()` to that operation; tagged invalidation refreshes affected
active loads. Clearing tag metadata alone is not invalidation. Define completion
after new props/state are committed so action callbacks can await it.

## Action selection

Use explicit `?/name` named actions, including full-path `/contacts?/toggleStar`,
as the supported migration syntax. Support the same parsing with or without JS;
no client-only URL rewrite is sufficient. Strip the leading `/` marker from the
selected action name; reject empty, duplicate or ambiguous selectors with 400.
Keep action names separate from application query values.

Named mode does not reserve `q` or arbitrary empty query keys. Thus
`?filter=unread&q=example` remains a search request. Select parsing with
`swelte.actionQuery: 'named' | 'legacy'`. With no setting, existing applications
keep legacy parsing; `compat: 'sveltekit'` selects named parsing unless explicitly
overridden. New app scaffolds set named mode explicitly. Generated SDK verb
stubs use the resolved syntax. Legacy mode preserves `?q=delete` / `?delete`
and continues reserving `q` by definition; applications needing search `q`
must select named mode. Diagnose mixed selectors in named mode; never silently
change existing consumers' default parsing.

Normal named submissions can preserve other query parameters, e.g.
`?/markRead&filter=unread&q=example`. On no-JS success, remove only the action
selector from the redirect URL; keep application filters. Redirect cross-page
submissions to the declared target/default target page, never an unvalidated
referrer. Explicit handler redirects retain their location and status.

## Enhancement and result handling

Prevent the native submit synchronously before calling or awaiting a callback.
`cancel()` stops enhanced submission as well as native submission. Honor
submitter action/method/enctype and successful submitter fields; keep file bytes
in multipart requests. Network failures/cancellation must clear navigation state.

The native SDK's existing positional result callback remains available.
The opt-in `$app/forms` adapter supplies `({ result, update })`; adapt once at
the boundary instead of patching every application component. Failure/success
payloads and redirects have explicit result types; errors are not reported as
successful mutations. Native/adapter result decoding must be covered with real
responses, not merely shape assertions.

Default success refreshes the current mounted page and applies its form result;
failure keeps values and publishes inline validation without navigation. Reset
occurs only on success when requested/defaulted, never merely because a result
arrived. Native `update({ reset: false, invalidate: false })` retains values and
skips refresh; the Kit adapter accepts `invalidateAll: false` and maps it to
that native option. Cross-page actions refresh the current page without changing its URL;
their default update must not overwrite unrelated current-page form data.

No-JS validation re-runs the target page's guarded load and renders that page
with failure status/form data. A generic error paragraph alone is not the page
form contract. Synthetic framework fixtures probe query/filter retention,
mutation result shapes, and inline errors. Product workflows belong to the
applications that consume Swelte.
