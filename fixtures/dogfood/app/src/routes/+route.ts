export function load({ props }: { props: { data: { locale: string } } }) {
  return { layoutProof: `layout:${props.data.locale}` }
}
