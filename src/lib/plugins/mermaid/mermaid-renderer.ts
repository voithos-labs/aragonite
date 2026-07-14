/**
 * Injectable Mermaid renderer for the render-primary reference block. Lives
 * under the dogfood harness (not `src/lib`) so `svelte-package` never bundles
 * it — the `mermaid` engine stays a devDependency, out of the published `dist/`.
 *
 * `MermaidBlock` mounts with the standard block props (no renderer channel), so
 * the injected engine travels by module, like the inline-math renderer:
 * `mermaidPlugin({ renderer })` sets it at install. There is no default engine —
 * absent a renderer the block renders its code statically with a note.
 */

import { createBoundedMemo } from '$lib/plugin';

export type MermaidRenderer = (code: string, id: string) => Promise<string /* svg */>;

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
 * Memoized per code text — re-renders of unchanged code do zero engine work. An
 * SVG string needs no per-caller clone (unlike the math renderer's DOM node), so
 * the bare `createBoundedMemo` value is the render promise. A parse failure
 * resolves to a legible `error`, never a throw, and is cached like a success
 * (same code, same failure).
 */
export function renderMermaid(code: string): Promise<MermaidRenderResult> {
	return memo(code, () => {
		const renderer = activeRenderer;
		return renderer
			? renderer(code, `aragonite-mermaid-${renderSeq++}`).then(
					(svg) => ({ svg }),
					(reason) => ({ error: reason instanceof Error ? reason.message : String(reason) })
				)
			: Promise.resolve({ error: 'renderer not configured' });
	});
}
