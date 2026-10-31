import { mount } from 'svelte'
import Index from './routes/+page.svelte'

mount(Index, { target: document.getElementById('app')! })
