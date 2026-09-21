/**
 * @vitest-environment jsdom
 *
 * The render layer that holds no renderer of its own. `createMemoizedRenderer`'s caching is
 * what this file proves; the KaTeX adapter it wraps is proven in `renderer.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
	createMemoizedRenderer,
	setMathRenderer,
	renderInlineMath,
	renderDisplayMath
} from '$lib/plugins/latex/math-renderer';

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

	// Editing one equation re-renders only that one. The `inner` spy is the render counter:
	// a cache keyed on anything but the source string, or no cache at all, would call it
	// again on an untouched equation and fail the last assertion.
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

		// The reactive re-run an edit triggers re-renders the untouched neighbours;
		// all cache hits, so the count holds.
		for (const eq of ['b^2', 'c^2']) render(eq, { display: false });
		expect(inner).toHaveBeenCalledTimes(4);
	});

	// The eviction rules are pinned once on the shared helper in bounded-memo.test.ts;
	// these pin the wrapper's own behavior instead.
});

describe('the injection seam', () => {
	// The cache key includes `display`; this pins the two functions passing the flag through,
	// since a `renderDisplayMath` passing `display: false` serves inline HTML for every block.
	it('renderInlineMath and renderDisplayMath each thread their own display flag', () => {
		const inner = vi.fn((source: string, opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = `${source}:${opts.display}`;
			return { dom };
		});
		setMathRenderer(inner);

		const inline = renderInlineMath('x^2');
		const display = renderDisplayMath('x^2');

		expect(inner).toHaveBeenNthCalledWith(1, 'x^2', { display: false });
		expect(inner).toHaveBeenNthCalledWith(2, 'x^2', { display: true });
		expect(inline.dom.textContent).toBe('x^2:false');
		expect(display.dom.textContent).toBe('x^2:true');
	});
});
