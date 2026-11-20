# Proposal for @swelte/media

A voice recorder, a camera preview and a spoken AI conversation all need capture, playback and cleanup. The proposed optional package would expose those operations to Svelte components and describe streams a V endpoint can receive or produce. A standalone recorder should work with local browser capture and playback alone. An application can add a transport for remote media and compose the tracks with [`@swelte/ai`](ai.md) for model-backed sessions.

## Streams and controls

Model an endpoint as a **typed stream plus a set of supported controls**. A stream can produce or consume timestamped samples. Each track describes its payload schema or encoding, units where relevant, clock and direction. A control addresses a specific endpoint and has a name, argument schema and result schema. Local browser endpoints and remote V endpoints expose the same contract to a Svelte component.

| Endpoint | Stream | Example controls |
| --- | --- | --- |
| Audio player | Consumes audio frames | Play, pause, seek to a media timestamp, change playback rate |
| Live thermometer | Produces timestamped temperatures in °C | Set sampling interval if the device supports it |
| Recorded movement viewer | Consumes a recorded position series | Play, pause, seek and step one sample |
| Motor adapter | Consumes target positions and produces measured positions on a separate track | Stop motion or set an operating mode supported by the adapter |

Discover controls per endpoint so a component can offer a seek bar for a recording or a sampling interval selector for a sensor. Document each control's scope. Pausing a chart freezes the local display while acquisition can continue. Stopping acquisition targets the sensor. Seeking through a recorded motor trace updates the viewer only. Driving a motor requires an explicit connection to a command input and separate authorization.

For a remote control, correlate the request and response by command ID. Distinguish acceptance from completion when an operation takes time. Report rejection or an unknown outcome after disconnect, and expose observed state separately so the UI can show what the endpoint actually did. Adapters define units, valid ranges, deadlines and disconnect behavior for command inputs. Expired movement targets are discarded. Reconnect never implicitly replays movement commands. Control delivery must remain responsive under data backpressure.

## Tracks and assets

| Content | Proposed contract |
| --- | --- |
| Voice and other audio | Describe the encoding, sample rate, channels and timebase. Capture and playback have independent lifetimes so a user can interrupt playback while keeping the microphone open. |
| Camera and video | Describe codec, dimensions, presentation timestamps and decodable frame boundaries. Related audio, video and caption tracks share a clock for synchronized presentation. |
| Images and recordings | Expose a bounded asset with a media type, byte size and dimensions or duration when known. An application can supply a local blob or an authorized remote reference. |
| App-defined timed data | Let an application declare a content type and timestamped payload, such as a sensor reading alongside a camera frame. The application supplies its decoder and renderer. |

A Svelte consumer needs observable capture and playback state, permission or format errors, an explicit stop operation and teardown that releases owned devices, buffers and subscriptions. Track identifiers and timestamps must survive a transport hop. An AI app can associate a track with a turn using those identifiers.

## Transport and buffering

Start with local capture and playback. For remote streams, prototype binary WebSocket frames carrying a track identifier, sequence and timestamp. Compare that path with WebRTC for duplex audio and live camera use before choosing a video API. SSE can announce an asset or track on the application's control channel. Swelte core continues to own generic connection and cancellation primitives. [Native streams](../streaming.md)

Bound queues in bytes and expose queue depth and dropped-frame counts. A recording requires complete data or an explicit failure. For a live preview, allow skipping late frames and resuming at a decodable boundary. A full queue must still allow stop and teardown. Remote asset access, storage lifetime and permission to subscribe belong to the application.

## Acceptance fixtures

1. **Standalone voice recorder.** Capture a clip, stop the microphone, play the clip, interrupt playback and record again. Check permission denial and component teardown. Verify that leaving the page releases the device and queued playback without an AI dependency.
2. **Voice-and-photo AI session.** Use the same playback operation when the user interrupts a generated reply. Delay provider cancellation and deliver an old audio chunk after the new turn starts. Verify immediate local silence and rejection of the stale chunk by the AI session. [Full session fixture](ai.md#first-end-to-end-fixture)
3. **Video transport experiment.** Replay a known camera clip with synchronized audio and a timed sensor series. Slow the receiver and measure latency, synchronization error, queue size and dropped frames. Use the results to choose a transport and document its supported formats.
4. **Sensor and motion simulator.** Stream measured positions into a live chart and record them. Pause the chart while sampling continues, then seek the recording and verify the simulator receives zero commands. Explicitly connect a target-position stream, issue Stop with a full data queue, and reconnect. Check the reported position, command outcome and absence of stale targets after reconnect.
