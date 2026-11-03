# Spec: `@[load]` page-data cascade

Ephemeral design note. Durable contract lives in `../rpc.md` (Attributes).

## Rule

Initial paint data comes from a `load` fn; interaction data comes from
stubs. On-click `fetch` stays. Everything the page needs at load time
comes from `load`.

## Shape

`@[load] name(req SwelteRequest[, parent T]) !R`

* Zero or one per `.v` file. Two = build error (file+line, both names).
* Never stacked with a verb/rpc/sse on the same fn (one transport per fn).
* No qualifier (loaders run for the whole page, not one `?q`).
* Level 0 (no ancestor load): exactly one param (`SwelteRequest`).
* Deeper levels: `(SwelteRequest, parent T)` where T is the previous
  level's return struct. Short (`AdminLayout`) or vType-prefixed
  (`AdminRoute_AdminLayout`) spelling — mismatch = build error.
* Returns the level's page-data value — any JSON-able V type (struct,
  map, string, array). No JSON in `.v` files: no `import json`, no
  `json.encode`/`decode`, no string building.
* Throw → the harness maps to `+error` props with status.

## Cascade

`Hand` (HTML navigations only, never fetch) resolves path →
`swelte_load_route()` (same precedence as `swelte_route`, api/* excluded)
→ builds a GET `SwelteRequest` → `swelte_load_for(prefix, req)` →
per-file `swelte_load()` runs ancestor `+route` loads root-first,
threading each level's TYPED value as `parent` into the next.
The leaf's return is `json.encode`d once at the edge (generated code) →
`props_json` for `render(route, props_json)`.

* No loads anywhere on the chain → `'{}'` (static shell, hydrates,
  client fetches). No build error — progressive adoption.
* `+route.v` may hold `@[load]` alongside `@[before]/@[after]` (still no
  `@[rpc]`/verbs). `@[before]` mutates `req` before loads see it
  (guard data flows into loaders through headers).
* TS projects `load` as a fetchable stub (client nav); the SSR pass
  never imports it — V runs it natively.
* Precedence is unidirectional (route → page): the leaf knows the
  wrapper's shape. That is the layout contract — enforced by the
  parent-type check, not incidental coupling.

## Example

```v
// admin/+route.v
pub struct AdminLayout { pub: section string org_id int }

@[load]
pub fn load_layout(req SwelteRequest) !AdminLayout {
    return AdminLayout{ section: 'admin', org_id: 7 }
}
```

```v
// admin/+page.v — parent is the ALREADY-BUILT wrapper value
@[load]
pub fn load_admin(req SwelteRequest, parent AdminRoute_AdminLayout) !AdminProps {
    return AdminProps{
        user: req.headers['x-user'] or { 'unknown' }
        section: parent.section
        org_id: parent.org_id
    }
}
```

Generated cascade (`.swelte/routes/admin__page.v`):

```v
pub fn swelte_admin__page_swelte_load(req SwelteRequest) !string {
    mut frag_0 := swelte_admin__route_load_layout(req) or { return err }
    mut frag_1 := swelte_admin__page_load_admin(req, frag_0) or { return err }
    return json.encode(frag_1)
}
```

## Boundaries

* Components must not re-fetch load-time data: the SSR compile pass
  rejects `#routes/*.v`/`#lib/*.v` stub imports with file+line (plain
  `#lib/*.js|ts|svelte` source is fine — bundled from disk). Move it into
  `$props()` and let `Hand` supply it.
* On-click stubs (`@[get]`/`@[rpc]` in handlers) unchanged.
* Three+ levels: each level's parent is the previous level's return —
  transitive ancestors are already folded in.
