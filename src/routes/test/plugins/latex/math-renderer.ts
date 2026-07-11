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

const MEMO_CAP = 256;

/**
 * Memoize the render *work*, not a live node: a single DOM node cannot occupy two
 * places, and the same formula is commonly rendered in several spots. We cache
 * `inner`'s result and clone it on every call (the cache node stays pristine), so
 * `inner` runs once per key while each caller gets its own detached node.
 *
 * Bounded LRU: every keystroke while editing source mints a new key, so an
 * unbounded map is a leak. Map iteration is insertion-ordered — re-inserting on
 * a hit makes the first key the least recently used.
 */
export function createMemoizedRenderer(inner: MathRenderer, cap = MEMO_CAP): MathRenderer {
	const cache = new Map<string, { dom: HTMLElement; error?: string }>();
	return (source, opts) => {
		const key = `${source}\x00${opts.display}`;
		let entry = cache.get(key);
		if (entry) {
			cache.delete(key);
		} else {
			entry = inner(source, opts);
			if (cache.size >= cap) cache.delete(cache.keys().next().value as string);
		}
		cache.set(key, entry);
		return { dom: entry.dom.cloneNode(true) as HTMLElement, error: entry.error };
	};
}

// ── Inline renderer wiring ────────────────────────────────────────────────────

// MathInline mounts with frozen `{ inline, source }` props (no renderer channel), so
// the injected engine travels by module — the moral equivalent of the closure the
// old buildMathWidget captured. `latexPlugin({ renderer })` sets it at install; the
// memoization spans the whole document, so a formula repeated across widgets renders
// once.
let activeInlineRenderer: MathRenderer = createMemoizedRenderer(katexRenderer);

export function setInlineMathRenderer(renderer: MathRenderer): void {
	activeInlineRenderer = createMemoizedRenderer(renderer);
}

export function renderInlineMath(source: string): { dom: HTMLElement; error?: string } {
	return activeInlineRenderer(source, { display: false });
}
