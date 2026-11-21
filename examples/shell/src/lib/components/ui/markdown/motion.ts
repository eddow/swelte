import type { AnimateOptions, Effect } from "@docvia/markdown";

export type MarkdownAnimate = boolean | Effect;

/** docvia word-entry options on our motion tokens; duration mirrors --duration-slow in ms. */
export function markdownMotion(animate: MarkdownAnimate): AnimateOptions | false {
	if (animate === false) return false;
	return {
		effect: animate === true ? "fade" : animate,
		duration: 250,
		easing: "var(--ease-ui-out)",
	};
}
