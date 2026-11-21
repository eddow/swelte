import { tv, type VariantProps } from "tailwind-variants";

export const message = tv({
	base: "group/message relative flex w-full min-w-0 gap-2 text-sm",
	variants: {
		align: {
			start: "origin-bottom-left flex-row",
			end: "origin-bottom-right flex-row-reverse",
		},
		// Data-only: the entrance is a plain class swap in the message component, not a tv() class,
		// same engine TextTransition uses. This purely derives the prop's type.
		motion: {
			spring: "",
			fade: "",
			none: "",
		},
	},
	defaultVariants: { align: "start", motion: "spring" },
});

export type MessageAlign = NonNullable<VariantProps<typeof message>["align"]>;
export type MessageMotion = NonNullable<VariantProps<typeof message>["motion"]>;

export const messageBubble = tv({
	base: "w-fit max-w-full wrap-break-word rounded-3xl px-4 py-2.5",
	variants: {
		variant: {
			default: "bg-muted text-foreground",
			primary: "bg-primary text-primary-foreground",
			tint: "bg-primary/10 text-foreground",
			outline: "border border-border bg-background text-foreground",
			destructive: "bg-destructive/10 text-destructive-strong",
			ghost: "rounded-none bg-transparent px-0 py-0",
		},
	},
	defaultVariants: { variant: "default" },
});

export type MessageBubbleVariant = NonNullable<
	VariantProps<typeof messageBubble>["variant"]
>;

/** A centred note in the thread, such as a date or "Conversation resumed". */
export const messageMarker = tv({
	base: "mx-auto flex w-fit max-w-[88%] items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-center text-muted-foreground text-xs",
});
