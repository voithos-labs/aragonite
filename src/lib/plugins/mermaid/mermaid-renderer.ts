/**
 * Injectable Mermaid renderer seam for the render-primary reference block. Ships
 * as part of `aragonite/plugins/mermaid` — engine-free: it holds the injected
 * renderer slot and the per-code memo, never the `mermaid` engine itself. That
 * engine is confined to the `/renderer` subpath (`renderer.ts`), which
 * dynamic-imports `mermaid` (an optional peer dependency) so it never rides the
 * plugin's core bundle.
 *
 * `MermaidBlock` mounts with the standard block props (no renderer channel), so
 * the injected engine travels by module, like the inline-math renderer:
 * `mermaidPlugin({ renderer })` sets it at install. There is no default engine —
 * absent a renderer the block renders its code statically with a note.
 */

import { createBoundedMemo } from '$lib/plugin';

/** What the editor knows at render time that the diagram text does not carry. */
export interface MermaidRenderContext {
	/** The editor's theme name (`data-editor-theme`; `'dark'`/`'light'` built in, or a
	 *  consumer's own). The engine paints colors INTO the SVG, so a stylesheet cannot
	 *  retheme a drawn diagram — the renderer has to draw for the theme. */
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
// A fresh memo per renderer swap clears the cache — the primitive owns no reset,
// so re-instantiation is the clear (mirrors the math renderer's setMathRenderer).
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
 * Memoized per (theme, code) — re-renders of unchanged code in an unchanged theme do
 * zero engine work, while a theme flip misses and redraws. The theme belongs in the
 * KEY rather than in a cache reset: flipping back is then a hit, and no stylesheet
 * could fix a diagram drawn for the other palette (the engine writes colors into the
 * SVG). An SVG string needs no per-caller clone (unlike the math renderer's DOM
 * node), so the bare `createBoundedMemo` value is the render promise. A parse failure
 * resolves to a legible `error`, never a throw, and is cached like a success (same
 * code, same failure).
 *
 * `theme` is required, not defaulted: a silent fallback on the one function whose whole
 * premise is that the theme is a render input would let a caller forget it and compile.
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
