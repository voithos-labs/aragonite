/**
 * KaTeX-backed math renderer for the first-party LaTeX extension. Lives under the
 * dogfood harness (not `src/lib`) so `svelte-package` never bundles it — that is
 * what keeps `katex` a devDependency, provably out of the published `dist/`.
 *
 * The renderer is injectable: widgets take a `MathRenderer`, defaulting to
 * `katexRenderer`, so a consumer can swap in another engine (MathJax, a server
 * pre-render) without touching widget code.
 */

import katex from 'katex';
// The stylesheet is the engine's dependency, not the route's: `htmlAndMathml`
// emits a `.katex-mathml` a11y tree this CSS clips to a 1px box — unloaded, every
// equation paints twice (the render plus the TeX echoed as text). Importing it
// here means no route installing the plugin can forget it; a consumer swapping in
// another engine owns that engine's stylesheet the same way.
import 'katex/dist/katex.min.css';
import { createBoundedMemo } from '$lib/plugin';

export type MathRenderer = (
	source: string,
	opts: { display: boolean }
) => { dom: HTMLElement; error?: string };

// ── Default engine ──────────────────────────────────────────────────────────

/**
 * `throwOnError: false` keeps a malformed formula from crashing the editor, but
 * KaTeX's fallback renders the source verbatim in `errorColor` — a bare raw-source
 * strip (A5 forbids that). We keep the flag, then detect KaTeX's documented
 * `.katex-error` span and swap in a legible message, surfacing the `title`
 * diagnostic as the `error` string.
 */
export const katexRenderer: MathRenderer = (source, { display }) => {
	const container = document.createElement('span');
	container.innerHTML = katex.renderToString(source, {
		throwOnError: false,
		displayMode: display,
		output: 'htmlAndMathml'
	});

	const errorSpan = container.querySelector('.katex-error');
	if (errorSpan) {
		const message = (errorSpan.getAttribute('title') ?? 'invalid LaTeX').replace(
			/^ParseError:\s*/,
			''
		);
		return { dom: buildErrorNode(message), error: message };
	}
	return { dom: container };
};

function buildErrorNode(message: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'math-error';
	span.textContent = `Math error: ${message}`;
	return span;
}

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

// ── Inline renderer wiring ────────────────────────────────────────────────────

// MathInline mounts with frozen `{ inline, source }` props (no renderer channel), so
// the injected engine travels by module: `latexPlugin({ renderer })` sets it at
// install. The memoization spans the whole document, so a formula repeated across
// widgets renders once.
let activeInlineRenderer: MathRenderer = createMemoizedRenderer(katexRenderer);

export function setInlineMathRenderer(renderer: MathRenderer): void {
	activeInlineRenderer = createMemoizedRenderer(renderer);
}

export function renderInlineMath(source: string): { dom: HTMLElement; error?: string } {
	return activeInlineRenderer(source, { display: false });
}
