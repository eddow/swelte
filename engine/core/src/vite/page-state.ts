// Generated as .svelte.js so the consumer's Svelte plugin compiles runes.
export const reactiveStateSource = `import { page as store, navigating, updated } from '@swelte/core'
let value = $state.raw(store.get())
store.subscribe((next) => { value = next })
export { navigating, updated }
export const page = {
  get url() { return new URL(value.url || '/', globalThis.location?.href || 'http://localhost/') },
  get route() { return value.routeInfo || { id: value.route, pattern: value.route } },
  get params() { return value.params || {} },
  get data() { return value.data || {} },
  get form() { return value.form ?? null },
  get status() { return value.status || 200 },
  get error() { return value.error || null },
  get state() { return value.state || {} }
}
`

export const reactivePropsSource = `export function createProps(value) { const props = $state(value); return props }\n`
