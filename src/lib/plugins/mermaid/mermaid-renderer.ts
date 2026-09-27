/**
 * Where the mermaid renderer is plugged in: `mermaidSlot` holds it and its cache, never mermaid
 * itself, which stays behind the `/renderer` subpath so it never lands in the main bundle.
 * `MermaidBlock` mounts with the standard block props, so it reads the renderer from here.
 */

import { createAsyncRendererSlot, type RenderContext } from '$lib/plugin';

/** What the editor knows at render time that the diagram text does not carry. */
export interface MermaidRenderContext {
	/** Mermaid paints colors into the SVG, so a stylesheet cannot retheme a drawn diagram:
	 *  the renderer has to draw for the theme. */
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

export const mermaidSlot = createAsyncRendererSlot<string, MermaidRenderResult>({
	key: (code) => code,
	missing: () => ({ error: 'renderer not configured' }),
	failed: (_code, error) => ({ error: error instanceof Error ? error.message : String(error) })
});

let renderSeq = 0;

/** Mermaid needs a fresh element id per render, which the slot's `(code, ctx)` call leaves out. */
export function adaptMermaidRenderer(
	renderer: MermaidRenderer
): (code: string, ctx: RenderContext) => Promise<MermaidRenderResult> {
	return (code, { theme }) =>
		renderer(code, `aragonite-mermaid-${renderSeq++}`, { theme }).then((svg) => ({ svg }));
}
