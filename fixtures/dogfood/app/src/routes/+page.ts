export function load({ props, depends }: { props: { data: { search: string; layoutProof: string } }; depends: (...tags: string[]) => void }) {
  depends('dogfood:home')
  if (props.data.search === 'universal-fail') throw new Error('private universal failure')
  if (props.data.search === 'ssr-timeout') {
    for (;;) (globalThis as { __dogfoodSpin?: number }).__dogfoodSpin = Math.random()
  }
  if (props.data.search === 'ssr-output') return { oversized: 'x'.repeat(1100000) }
  if (props.data.search === 'ssr-head') return { headProof: 'x'.repeat(10000) }
  return { viewProof: `${props.data.layoutProof}:${props.data.search}` }
}
export const prerender = false
