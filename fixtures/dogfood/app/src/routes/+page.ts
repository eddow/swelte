export function load({ props, depends }: { props: { data: { search: string; layoutProof: string } }; depends: (...tags: string[]) => void }) {
  depends('dogfood:home')
  if (props.data.search === 'universal-fail') throw new Error('private universal failure')
  return { viewProof: `${props.data.layoutProof}:${props.data.search}` }
}
