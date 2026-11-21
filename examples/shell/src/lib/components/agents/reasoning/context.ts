import { getContext, setContext } from "svelte";

export type ActiveStep = { id: string; label: string };

type ReasoningContext = { setActive: (step: ActiveStep | null, id: string) => void };

const KEY = Symbol("reasoning");

export function setReasoningContext(value: ReasoningContext) {
	setContext(KEY, value);
}

export function useReasoning(): ReasoningContext | undefined {
	return getContext<ReasoningContext | undefined>(KEY);
}
