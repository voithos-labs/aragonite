/**
 * Engine-free math render seam for the LaTeX plugin. The renderer is injected —
 * `latexPlugin({ renderer })` sets it here at install — so the plugin core never
 * imports a math engine; the katex adapter lives in `renderer.ts`, reached through
 * the `aragonite/plugins/latex/renderer` subpath. Both the inline `$…$` widget and
 * the block `$$…$$` leaf read the active renderer through this module (their frozen
 * props carry no renderer channel), and one document-wide memo means a formula
 * repeated across widgets renders once.
 */

import { createBoundedMemo } from '$lib/plugin';

export type MathRenderer = (
	source: string,
	opts: { display: boolean }
) => { dom: HTMLElement; error?: string };

// ── Memoized wrapper ──────────────────────────────────────────────────────────

const MEMO_CAP = 256;

/**
 * Memoize the render *work* keyed on `(source, display)`, cloning the cached node
 * on every read so `inner` runs once per key while each caller gets its own
 * detached node. The bounded-LRU cache is the platform's `createBoundedMemo`; the
 * clone-on-read is why math uses the primitive's `cloneOnRead` hook.
 */
export function createMemoizedRenderer(inner: MathRenderer, cap = MEMO_CAP): MathRenderer {
	const memo = createBoundedMemo<string, { dom: HTMLElement; error?: string }>({
		cap,
		cloneOnRead: (entry) => ({ dom: entry.dom.cloneNode(true) as HTMLElement, error: entry.error })
	});
	return (source, opts) => memo(`${source}\x00${opts.display}`, () => inner(source, opts));
}

// ── Injection seam ──────────────────────────────────────────────────────────────

// The injected engine travels by module (the widgets read it through this seam),
// not the frozen props channel: `setMathRenderer` wraps it in the document-wide
// memo at install. There is deliberately NO default engine — the core must not
// import one, and the plugin's required `renderer` option guarantees this is set
// before any widget mounts. Inline `$…$` is text-mode; block `$$…$$` is display.
let activeRenderer: MathRenderer | null = null;

export function setMathRenderer(renderer: MathRenderer): void {
	activeRenderer = createMemoizedRenderer(renderer);
}

export function renderInlineMath(source: string): { dom: HTMLElement; error?: string } {
	return render(source, false);
}

export function renderDisplayMath(source: string): { dom: HTMLElement; error?: string } {
	return render(source, true);
}

function render(source: string, display: boolean): { dom: HTMLElement; error?: string } {
	if (!activeRenderer) {
		const dom = document.createElement('span');
		dom.className = 'math-error';
		dom.textContent = 'Math error: renderer not configured';
		return { dom, error: 'renderer not configured' };
	}
	return activeRenderer(source, { display });
}
