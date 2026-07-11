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
 * throw, and is cached like a success (same code, same failure).
 */
export function renderMermaid(code: string): Promise<MermaidRenderResult> {
	let entry = cache.get(code);
	if (!entry) {
		const renderer = activeRenderer;
		entry = renderer
			? renderer(code, `aragonite-mermaid-${renderSeq++}`).then(
					(svg) => ({ svg }),
					(reason) => ({ error: reason instanceof Error ? reason.message : String(reason) })
				)
			: Promise.resolve({ error: 'renderer not configured' });
		cache.set(code, entry);
	}
	return entry;
}
