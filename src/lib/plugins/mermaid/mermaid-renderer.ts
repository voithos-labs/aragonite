/**
 * The renderer-adapter seam: this module holds the injected renderer slot and the
 * memo, never the engine, which is confined to the `/renderer` subpath so it never
 * rides the core bundle. The engine travels by module because `MermaidBlock` mounts
 * with standard block props. No default: absent a renderer the code renders statically.
 */

import { createBoundedMemo } from '$lib/plugin';

/** What the editor knows at render time that the diagram text does not carry. */
export interface MermaidRenderContext {
	/** The engine paints colors into the SVG, so a stylesheet cannot retheme a drawn
	 *  diagram: the renderer has to draw for the theme. */
	theme: string;
}

/** Third parameter, so an existing `(code, id) => …` renderer stays assignable. */
export type MermaidRenderer = (
	code: string,
	id: string,
	context: MermaidRenderContext
) => Promise<string /* svg */>;

export interface MermaidRenderResult {
	svg?: string;
	error?: string;
}

/** Exported so the eviction test derives its churn count from the real bound. */
export const MERMAID_MEMO_CAP = 256;

const newMemo = () =>
	createBoundedMemo<string, Promise<MermaidRenderResult>>({ cap: MERMAID_MEMO_CAP });

let activeRenderer: MermaidRenderer | null = null;
// The primitive owns no reset, so re-instantiation is how a renderer swap clears it.
let memo = newMemo();
let renderSeq = 0;

export function setMermaidRenderer(renderer: MermaidRenderer | null): void {
	activeRenderer = renderer;
	memo = newMemo();
}

export function hasMermaidRenderer(): boolean {
	return activeRenderer !== null;
}

/**
 * Theme belongs in the memo key rather than in a cache reset, so flipping back is a
 * hit; unlike the math renderer's DOM node, an SVG string needs no per-caller clone.
 * A parse failure resolves to an `error` and caches like a success. `theme` is
 * required, not defaulted, so a caller cannot forget the render input and compile.
 */
export function renderMermaid(code: string, theme: string): Promise<MermaidRenderResult> {
	// NUL-joined so no (theme, code) pair can concatenate into another's key.
	return memo(`${theme}\0${code}`, () => {
		const renderer = activeRenderer;
		return renderer
			? renderer(code, `aragonite-mermaid-${renderSeq++}`, { theme }).then(
					(svg) => ({ svg }),
					(reason) => ({ error: reason instanceof Error ? reason.message : String(reason) })
				)
			: Promise.resolve({ error: 'renderer not configured' });
	});
}
