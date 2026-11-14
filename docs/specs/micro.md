# Historical application inventory

This inventory is retained as audit context only. It is not a Swelte
implementation plan, does not assign work to this repository, and does not
block Swelte completion. The [Swelte roadmap](dogfood-roadmap.md) tracks only
framework behavior and its synthetic regression probes.

Earlier inventories sometimes treated existing native dependencies as missing
framework implementations. V already provides PostgreSQL ORM/pooling and
transaction support; Swelte can connect applications to those facilities
without implementing another ORM. Browser-safe JavaScript libraries can also
remain JavaScript when used on the client.

## Framework capabilities exposed by the audit

| Topic | Swelte probe (if applicable) |
|---|---|
| PostgreSQL and startup | DF-08 probes integration with V's existing database facilities; application schema/history remains application-owned. |
| Realtime SSE / WS | DF-04, DF-10, and DF-11 probe request guards, POST streaming, and disconnect cleanup. |
| Binary bodies and uploads | DF-04 and DF-07 probe generic multipart and binary transport; domain attachment behavior is outside Swelte scope. |
| Locale, routing, SSR, and prerender | DF-02, DF-05, DF-06, and DF-14 probe generic framework behavior; locale and host policy remain application choices. |
| HTTP integrations and observability | DF-09, DF-13, and DF-15 cover generic native diagnostics, lifecycle, and reporting hooks; provider adapters are outside scope. |
| Validation and parsing libraries | Browser-safe TS reuse and native backend dependencies are integration choices, not requirements to port application libraries. |

## Application-only topics

The following requirements remain with the projects that own those products.
They are not open Swelte work and need no implementation estimate here.

| Area | Historical application requirements |
|---|---|
| Authentication/session | Auth consumers, session context, provider behavior, locale, subdomain, and cookie/cache policy. |
| Durable financial jobs | Bill queues/workers, expiry, capture concurrency, and restart coordination. |
| Payments and banking | Payment/banking flows, signatures, raw-body verification, and event idempotency. |
| Documents and media | Image/PDF processing, archives, QR generation, and storage integrations. |

Application-specific queries, migrations, workers, auth policy, and
integrations stay in their owning project or reusable libraries. Swelte owns
only generic framework contracts those projects may choose to use.
