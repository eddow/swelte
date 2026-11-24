# Native response streams

> Detailed reference for the [capability contract](spec.md). Implementation
> notes and measurements describe their stated scope, not additional guarantees.

Verb handlers can return raw byte streams, including POST responses with request
bodies and application-owned SSE framing:

```v
@[post]
pub fn chat(req SwelteRequest) !SwelteResponse {
    // Validate the body and authorize before returning a streaming response.
    if req.raw_body.len == 0 { return swelte_error(400, 'body required') }
    return swelte_stream({'Content-Type': 'text/event-stream'}, fn (stream SwelteStream) ! {
        if !stream.write('event: delta\ndata: {"text":"hello"}\n\n'.bytes()) { return }
        stream.write('event: done\ndata: {}\n\n'.bytes())
    })
}
```

Before hooks execute before the handler; after hooks supply headers and cookies
before the transport takes over the connection. Headers are sent before the
producer starts. Return ordinary errors before returning `swelte_stream` when
the HTTP status must change. A producer error after headers closes the stream
and records a generic server diagnostic; it cannot change the HTTP status.
The transport does not encode JSON, prefix SSE events or reinterpret UTF-8.

`SwelteStream.write([]u8) bool` copies and queues a chunk, blocking when the
bounded eight-chunk queue is full. False means cancellation or a chunk exceeding
`SWELTE_STREAM_CHUNK_LIMIT` (default 65536 bytes). Stop producing when false.
`cancelled chan bool` is closed by the transport after disconnect detection,
completion, idle timeout or write timeout. Select on it while waiting for
upstream data; never send to it or close it. Release subscriptions/resources
with `defer`. Disconnect detection occurs on writes or timeout, rather than
through a separate immediate socket monitor.

`SWELTE_STREAM_IDLE_MS` (default 30000) bounds waiting for the next chunk and
socket writes. Idle providers should emit protocol-appropriate heartbeat bytes
or choose a larger timeout. Empty writes poll cancellation and send no bytes.
The current HTTP/1.1 response is close-delimited; the native harness owns framing.
Taken-over sockets use nonblocking writes so the timeout also applies when a
connected client stops reading. GET SSE uses the same write timeout and releases
blocked emitters when its writer ends; waiting for the next GET SSE event remains
long-lived. App-owned upstream waits must still observe cancellation.

Application libraries can accept injected write/cancel callbacks without
importing generated routes. Decide whether a subscriber disconnect cancels an
underlying run in the application; a durable run may outlive one subscriber.
Existing GET `@[sse]` and WS APIs remain separate conveniences. Swelte provides
generic stream transport and lifecycle behavior; providers, durable run stores,
and domain-level shutdown policy belong to the consuming application/library.

`npm run test:dogfood` exercises native SSE/WS guards/metadata, POST byte
streaming, split UTF-8, pre/post-header failures and disconnect/idle cleanup.
