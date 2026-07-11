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

export type MermaidRenderer = (code: string, id: string) => Promise<string /* svg */>;

export interface MermaidRenderResult {
	svg?: string;
	error?: string;
}

/** Exported so the eviction test derives its churn count from the real bound. */
export const MERMAID_MEMO_CAP = 256;

let activeRenderer: MermaidRenderer | null = null;
let cache = new Map<string, Promise<MermaidRenderResult>>();
let renderSeq = 0;

export function setMermaidRenderer(renderer: MermaidRenderer | null): void {
	activeRenderer = renderer;
	cache = new Map();
}

export function hasMermaidRenderer(): boolean {
	return activeRenderer !== null;
}

/**
 * Memoized per code text — re-renders of unchanged code do zero engine work
 * (the async sibling of the math renderer's memoization; an SVG string needs no
 * per-caller clone). A parse failure resolves to a legible `error`, never a
 * throw, and is cached like a success (same code, same failure). Bounded like
 * the math memo: LRU via Map insertion order, re-inserted on hit.
 */
export function renderMermaid(code: string): Promise<MermaidRenderResult> {
	let entry = cache.get(code);
	if (entry) {
		cache.delete(code);
	} else {
		const renderer = activeRenderer;
		entry = renderer
			? renderer(code, `aragonite-mermaid-${renderSeq++}`).then(
					(svg) => ({ svg }),
					(reason) => ({ error: reason instanceof Error ? reason.message : String(reason) })
				)
			: Promise.resolve({ error: 'renderer not configured' });
		if (cache.size >= MERMAID_MEMO_CAP) cache.delete(cache.keys().next().value as string);
	}
	cache.set(code, entry);
	return entry;
}
