import type { Snippet } from "svelte";

export type ToolDetailLine = { text: string; tone?: "add" };

export type ToolStep = {
	icon?: Snippet;
	label: string;
	chip: string;
	mono?: boolean;
	detailMono?: boolean;
	detail: ToolDetailLine[];
};

export type ToolDiffLine = { text: string; tone: "add" | "del" | "ctx" };

export type ToolDiff = {
	file: string;
	add: number;
	del: number;
	lines?: ToolDiffLine[];
};

export type ToolChipsLabels = {
	header?: string;
};
