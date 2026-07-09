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

/**
 * Memoize the render *work*, not a live node: a single DOM node cannot occupy two
 * places, and the same formula is commonly rendered in several spots. We cache
 * `inner`'s result and clone it on every call (the cache node stays pristine), so
 * `inner` runs once per key while each caller gets its own detached node.
 */
export function createMemoizedRenderer(inner: MathRenderer): MathRenderer {
	const cache = new Map<string, { dom: HTMLElement; error?: string }>();
	return (source, opts) => {
		const key = `${source}\x00${opts.display}`;
		let entry = cache.get(key);
		if (!entry) {
			entry = inner(source, opts);
			cache.set(key, entry);
		}
		return { dom: entry.dom.cloneNode(true) as HTMLElement, error: entry.error };
	};
}
