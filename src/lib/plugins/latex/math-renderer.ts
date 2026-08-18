/**
 * The renderer-adapter seam: `latexPlugin({ renderer })` injects the engine here at
 * install, so the plugin core never imports one. Widgets and leaves read the active
 * renderer through this module because their frozen props carry no renderer channel,
 * and the one document-wide memo means a repeated formula renders once.
 */

import { createBoundedMemo } from '$lib/plugin';

export type MathRenderer = (
	source: string,
	opts: { display: boolean }
) => { dom: HTMLElement; error?: string };

// ── Memoized wrapper ──────────────────────────────────────────────────────────

const MEMO_CAP = 256;

/**
 * Memoizes the render work, not the node: `cloneOnRead` is what lets `inner` run once
 * per key while each caller still gets its own detached node to mount.
 */
export function createMemoizedRenderer(inner: MathRenderer): MathRenderer {
	const memo = createBoundedMemo<string, { dom: HTMLElement; error?: string }>({
		cap: MEMO_CAP,
		cloneOnRead: (entry) => ({ dom: entry.dom.cloneNode(true) as HTMLElement, error: entry.error })
	});
	return (source, opts) => memo(`${source}\x00${opts.display}`, () => inner(source, opts));
}

// ── Injection seam ──────────────────────────────────────────────────────────────

// Deliberately no default engine: the core must not import one, and the plugin's
// required `renderer` option guarantees this is set before any widget mounts.
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
