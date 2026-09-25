/**
 * Where the renderer is plugged in: this module holds the current renderer and the cache, never
 * mermaid itself, which stays behind the `/renderer` subpath so it never lands in the main
 * bundle. The renderer is held here rather than passed in because `MermaidBlock` mounts with
 * the standard block props. No default: with no renderer the code is shown as plain text.
 */

import { createBoundedMemo } from '$lib/plugin';

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

/** Exported so the eviction test takes its entry count from the real limit. */
export const MERMAID_MEMO_CAP = 256;

const newMemo = () =>
	createBoundedMemo<string, Promise<MermaidRenderResult>>({ cap: MERMAID_MEMO_CAP });

let activeRenderer: MermaidRenderer | null = null;
// The cache has no clear method, so building a new one is how a renderer swap empties it.
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
 * Keyed on theme and code, so switching the theme back is a cache hit. A parse failure resolves
 * to an `error` and is cached like a success.
 */
export function renderMermaid(code: string, theme: string): Promise<MermaidRenderResult> {
	// Joined with a NUL so no (theme, code) pair can run together into another pair's key.
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
