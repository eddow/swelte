<script lang="ts">
// Generic assistant answer: reasoning (thinking) + tool sessions + markdown.
// The chat pane feeds this from engine `WireEvent`s (text.delta,
// tool.progress, approval.request, terminal). Baby UI parts render each
// layer: Reasoning for the thinking trace, ToolChips for tool calls,
// Markdown (streaming) for the answer text.
import { Markdown } from '#lib/components/ui/markdown/index.js'
import { Reasoning, ReasoningStep, ReasoningSteps } from '#lib/components/agents/reasoning/index.js'
import { ToolChips, type ToolDiff, type ToolStep } from '#lib/components/agents/tool-chips/index.js'

export interface AiThinkingStep {
	label: string
	status: 'pending' | 'active' | 'done'
	detail?: string
}

/** One tool call in the session. `status` drives the row appearance. */
export interface AiToolCall {
	id: string
	label: string
	chip: string
	status: 'pending' | 'active' | 'done' | 'failed'
	detail?: string[]
}

interface Props {
	/** Thinking trace rows (collapsed into Reasoning when non-empty). */
	thinking?: AiThinkingStep[]
	/** True while the model is still reasoning. */
	thinkingActive?: boolean
	/** Seconds spent thinking (header once done). */
	thinkingDuration?: number
	/** Tool calls this turn (rendered as ToolChips when non-empty). */
	tools?: AiToolCall[]
	/** File diffs attached to the tool session. */
	diffs?: ToolDiff[]
	/** Assembled markdown answer (whole text so far). */
	text: string
	/** True while deltas still arrive. */
	streaming?: boolean
	/** Author line for the bubble meta. */
	author?: string
	class?: string
}

let {
	thinking = [],
	thinkingActive = false,
	thinkingDuration = 0,
	tools = [],
	diffs = [],
	text,
	streaming = false,
	author,
	class: classProp,
}: Props = $props()

function toolSteps(calls: AiToolCall[]): ToolStep[] {
	return calls.map((c) => ({
		id: c.id,
		label: c.label,
		chip: c.status === 'done' ? 'done' : c.status === 'pending' ? 'approval' : c.status === 'failed' ? 'failed' : 'running',
		mono: false,
		detailMono: true,
		detail: [
			{
				text: c.status === 'done' ? 'done' : c.status === 'failed' ? 'failed' : c.status,
				tone: undefined as never,
			},
			...(c.detail ?? []).map((text) => ({ text })),
		],
	}))
}

const steps = $derived(toolSteps(tools))
</script>
<div class={classProp}>
	{#if thinking.length > 0}
		<Reasoning thinking={thinkingActive} duration={thinkingDuration} variant="inline">
			<ReasoningSteps>
				{#each thinking as step (step.label)}
					<ReasoningStep label={step.label} status={step.status}>
						{#if step.detail}
							{step.detail}
						{/if}
					</ReasoningStep>
				{/each}
			</ReasoningSteps>
		</Reasoning>
	{/if}
	{#if tools.length > 0}
		<ToolChips {steps} {diffs} size="sm" />
	{/if}
	{#if text}
		<Markdown content={text} {streaming} animate="settle" />
	{:else if streaming}
		<span class="ai-answer-thinking" role="status">Thinking…</span>
	{/if}
	{#if author && !streaming && text}
		<p class="ai-answer-meta">{author}</p>
	{/if}
</div>

<style>
.ai-answer-thinking {
	opacity: 0.55;
	font-size: 0.85rem;
	animation: pulse 1.6s ease-in-out infinite;
}
.ai-answer-meta {
	font-size: 0.75rem;
	opacity: 0.55;
	margin: 0.3rem 0 0;
}
@keyframes pulse {
	50% {
		opacity: 0.3;
	}
}
@media (prefers-reduced-motion: reduce) {
	.ai-answer-thinking {
		animation: none;
	}
}
</style>
