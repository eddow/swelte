<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "#lib/cn.js";
import { type ReasoningStepStatus, reasoningStep } from "./variants";
import { useReasoning } from "./context";

let {
	label,
	description,
	status = "done",
	children,
	class: classProp,
}: {
	label: string;
	description?: string;
	/** Pending steps stay hidden until they turn active or done. */
	status?: ReasoningStepStatus;
	children?: Snippet;
	class?: string;
} = $props();

const id = $props.id();
const context = useReasoning();
const styles = $derived(reasoningStep({ status }));

$effect(() => {
	if (!context) return;
	context.setActive(status === "active" ? { id, label } : null, id);
	return () => context.setActive(null, id);
});
</script>

{#if status !== "pending"}
	<li data-slot="reasoning-step" data-status={status} class={cn(styles.item(), classProp)}>
		<div class={styles.clip()}>
			<div class={styles.row()}>
				<div class={styles.rail()}>
					<div class={styles.glyphBox()}>
						{#key status}
							<span class={styles.glyph()} aria-hidden="true">
								{#if status === "done"}
									<svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="size-3 text-foreground">
										<path
											d="m2.5 6.2 2.3 2.3 4.7-4.9"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								{/if}
							</span>
						{/key}
					</div>
					<span
						data-slot="reasoning-step-connector"
						aria-hidden="true"
						class={styles.connector()}
					></span>
				</div>
				<div class={styles.body()}>
					<p class={styles.label()}>{label}</p>
					{#if description}
						<p class={styles.description()}>{description}</p>
					{/if}
					{@render children?.()}
				</div>
			</div>
		</div>
	</li>
{/if}
