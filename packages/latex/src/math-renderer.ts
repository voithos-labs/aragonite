/**
 * What a math renderer is: `latex({ renderer })` hands one in, so the plugin's own code never
 * imports KaTeX. `katexRenderer` from `./renderer` is the bundled one.
 */
import { renderSourceFallback } from '@voithos-labs/aragonite/plugin';

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

/** A formula the renderer rejected: its typed source in the error color, with the parser's
 *  message on hover. */
export function mathErrorNode(source: string, message: string): HTMLElement {
	const dom = renderSourceFallback(source, message);
	dom.className = 'math-error';
	dom.style.color = 'var(--color-error)';
	return dom;
}
