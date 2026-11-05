<!-- Streamed fragment: reads NO parent state (static text only), so the
     boundary's async region never touches parent $state after an await
     (Svelte await_reactivity_loss rule). The parent keeps its prop reads
     synchronous outside the boundary. -->
<p>{await Promise.resolve('streamed client fragment (async <await>, never SSR)')}</p>
