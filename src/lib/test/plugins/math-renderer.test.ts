/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import {
	katexRenderer,
	createMemoizedRenderer
} from '../../../routes/test/plugins/latex/math-renderer';

describe('createMemoizedRenderer', () => {
	it('runs inner once per (source, display) and hands back a fresh node each call', () => {
		const inner = vi.fn((source: string, _opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = source;
			return { dom };
		});
		const render = createMemoizedRenderer(inner);

		const first = render('x^2', { display: false });
		const second = render('x^2', { display: false });

		expect(inner).toHaveBeenCalledTimes(1);
		// A live node can't sit in two places: repeats must clone, not alias the cache.
		expect(second.dom).not.toBe(first.dom);
		expect(first.dom.textContent).toBe('x^2');
		expect(second.dom.textContent).toBe('x^2');
	});

	it('keys on display: the same source in display mode is a distinct entry', () => {
		const inner = vi.fn((source: string, opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = `${source}:${opts.display}`;
			return { dom };
		});
		const render = createMemoizedRenderer(inner);

		render('x^2', { display: false });
		render('x^2', { display: true });

		expect(inner).toHaveBeenCalledTimes(2);
	});

	// A2 — editing one equation re-renders only IT. The injectable `inner` spy is
	// the render counter: a memo keyed on anything but the source string (or none)
	// would call it again on an untouched equation and trip the final assertion.
	it('re-renders only the edited equation; untouched ones stay cache hits (A2)', () => {
		const inner = vi.fn((source: string, _opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = source;
			return { dom };
		});
		const render = createMemoizedRenderer(inner);

		// A three-equation document: one render each.
		for (const eq of ['a^2', 'b^2', 'c^2']) render(eq, { display: false });
		expect(inner).toHaveBeenCalledTimes(3);

		// Edit one equation (a^2 → a^3): exactly one new render.
		render('a^3', { display: false });
		expect(inner).toHaveBeenCalledTimes(4);

		// The reactive re-run an edit triggers re-renders the untouched siblings —
		// all cache hits, so the count holds.
		for (const eq of ['b^2', 'c^2']) render(eq, { display: false });
		expect(inner).toHaveBeenCalledTimes(4);
	});

	// A2 — flat latency to 75+ equations: N distinct sources cost N renders, and a
	// full re-render pass over all N adds nothing. The large-doc thesis (a note
	// with 75 equations must not re-render all 75 on every edit) reduces to this.
	it('renders 75 equations once each; a full re-render pass adds nothing (A2)', () => {
		const inner = vi.fn((_source: string, _opts: { display: boolean }) => ({
			dom: document.createElement('span')
		}));
		const render = createMemoizedRenderer(inner);
		const equations = Array.from({ length: 75 }, (_, i) => `x_{${i}}`);

		for (const eq of equations) render(eq, { display: false });
		expect(inner).toHaveBeenCalledTimes(75);

		for (const eq of equations) render(eq, { display: false });
		expect(inner).toHaveBeenCalledTimes(75);
	});

	// Every keystroke while editing source mints a new key, so the cache must be
	// bounded: past the cap the least-recently-used entry is evicted, and a hit
	// refreshes recency so hot formulas survive churn.
	it('evicts the least-recently-used entry past the cap; a hit refreshes recency', () => {
		const inner = vi.fn((_source: string, _opts: { display: boolean }) => ({
			dom: document.createElement('span')
		}));
		const render = createMemoizedRenderer(inner, 2);

		render('a', { display: false });
		render('b', { display: false });
		render('a', { display: false }); // hit — 'a' becomes most recent
		expect(inner).toHaveBeenCalledTimes(2);

		render('c', { display: false }); // evicts 'b' (LRU), not 'a'
		expect(inner).toHaveBeenCalledTimes(3);

		render('a', { display: false }); // still cached
		expect(inner).toHaveBeenCalledTimes(3);
		render('b', { display: false }); // evicted — renders again
		expect(inner).toHaveBeenCalledTimes(4);
	});
});

describe('katexRenderer', () => {
	it('renders valid math with MathML in the DOM (A9)', () => {
		const { dom, error } = katexRenderer('x^2', { display: false });

		expect(error).toBeUndefined();
		// KaTeX wraps its MathML in a `.katex-mathml` span; jsdom parses that class
		// reliably even where it drops the foreign-content <math> element itself.
		expect(dom.querySelector('.katex-mathml')).not.toBeNull();
	});

	// A5 — invalid math surfaces a legible inline message, never KaTeX's raw
	// `.katex-error` source strip. This adapter-level proof is A5's primary guard;
	// latex-acceptance.spec.ts ties it to the live widget-build path in a browser.
	it('renders invalid math as a legible error node, never the raw source (A5)', () => {
		const source = '\\frac{';
		const { dom, error } = katexRenderer(source, { display: false });

		expect(error).toBeTruthy();
		const text = dom.textContent ?? '';
		// KaTeX's throwOnError:false emits a strip whose text IS the raw source;
		// the adapter must replace it with a human message.
		expect(text).not.toBe(source);
		expect(text.toLowerCase()).toContain('error');
	});
});
