import Panel from '@swelte-dogfood/sample-lib/Panel.svelte'
import type { ComponentProps } from 'svelte'
import { normalize } from '@swelte-dogfood/sample-lib/v/text.v'

const props: ComponentProps<typeof Panel> = { message: 'typed UI' }
const result: Promise<string> = normalize({ input: props.message })
void result
