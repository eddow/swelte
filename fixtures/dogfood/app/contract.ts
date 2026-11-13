import Panel from '@swelte-dogfood/ai1/Panel.svelte'
import type { ComponentProps } from 'svelte'
import { normalize } from '@swelte-dogfood/ai1/v/text.v'

const props: ComponentProps<typeof Panel> = { message: 'typed UI' }
const result: Promise<string> = normalize({ input: props.message })
void result
