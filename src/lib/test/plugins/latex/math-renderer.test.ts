/**
 * @vitest-environment jsdom
 *
 * The engine-free render seam. `createMemoizedRenderer`'s memoization contract is
 * the core half of the core/adapter split; the katex adapter it wraps is proven in
 * `renderer.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMemoizedRenderer } from '$lib/plugins/latex/math-renderer';

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

	// The bounded-LRU mechanics (eviction, recency, clone identity) are pinned once
	// on the shared primitive in bounded-memo.test.ts; these cases pin the wrapper's
	// own contract — cloneOnRead wiring and the (source, display) composite key.
});
