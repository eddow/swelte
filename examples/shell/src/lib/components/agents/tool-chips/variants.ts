import { tv, type VariantProps } from "tailwind-variants";

export const toolChips = tv({
	slots: { root: "w-full pb-1" },
	variants: {
		size: {
			sm: { root: "max-w-64" },
			default: { root: "max-w-80" },
			lg: { root: "max-w-96" },
		},
	},
	defaultVariants: { size: "default" },
});

export type ToolChipsSize = NonNullable<VariantProps<typeof toolChips>["size"]>;
