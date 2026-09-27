/**
 * Where the math renderer is plugged in: `latexPlugin({ renderer })` sets it at install time, so
 * the plugin's own code never imports KaTeX. Blocks and widgets render through `mathSlot`
 * because their props carry no renderer; one cache for the whole document means a repeated
 * formula renders once per theme.
 */

import { createRendererSlot, renderSourceFallback } from '$lib/plugin';

/** `theme` is for an adapter that draws its own colors; one written against `{ display }` alone
 *  stays assignable. */
export type MathRenderer = (
	source: string,
	opts: { display: boolean; theme: string }
) => MathRender;

export interface MathRender {
	dom: HTMLElement;
	error?: string;
}

export const mathSlot = createRendererSlot<{ source: string; display: boolean }, MathRender>({
	key: ({ source, display }) => `${display}\0${source}`,
	// A cached node can sit in one place only, so every caller mounts its own copy.
	cloneOnRead: ({ dom, error }) => ({ dom: dom.cloneNode(true) as HTMLElement, error }),
	missing: ({ source }) => ({ dom: renderSourceFallback(source, 'Math renderer not configured') }),
	failed: ({ source }, error) => {
		const message = error instanceof Error ? error.message : String(error);
		return { dom: mathErrorNode(source, message), error: message };
	}
});

/** A formula the renderer rejected: its typed source, with the parser's message on hover. */
export function mathErrorNode(source: string, message: string): HTMLElement {
	const dom = renderSourceFallback(source, message);
	dom.className = 'math-error';
	return dom;
}
