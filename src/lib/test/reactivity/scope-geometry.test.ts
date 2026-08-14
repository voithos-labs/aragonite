import { describe, it, expect } from 'vitest';
import {
	estimateWidth,
	effectiveViewportHeight,
	listTopWithinContent
} from '../../reactivity/scope-geometry';

describe('estimateWidth', () => {
	// VR-3: a nested scope must estimate at its OWN content width, not the scrollport's —
	// the oracle's line-wrap is monotonic in width, so the wider port systematically
	// undercounts wrapped heights at depth.
	it('prefers the scope content element width over the scrollport', () => {
		expect(estimateWidth({ clientWidth: 400 }, 800)).toBe(400);
	});

	it('falls back to the scrollport, then a constant, when the list element is absent', () => {
		expect(estimateWidth(null, 800)).toBe(800);
		expect(estimateWidth(null, 0)).toBe(800);
	});

	// A zero-width (pre-layout) list element is unusable — fall through rather than
	// estimate every block at one char per line.
	it('falls through a zero-width list element to the scrollport', () => {
		expect(estimateWidth({ clientWidth: 0 }, 800)).toBe(800);
	});
});

describe('listTopWithinContent', () => {
	// The editor owns the scrollport: its box top IS the viewport top, so the two port
	// terms are the identity mapping and the list's rect top is already content-space.
	it('maps a list at the top of a self-scrolled editor to offset zero', () => {
		expect(listTopWithinContent(0, 0, 0)).toBe(0);
		// Scrolled 900px down, the list's rect has travelled the same distance up.
		expect(listTopWithinContent(-900, 0, 900)).toBe(0);
	});

	// The load-bearing case: a page-scrolled shell puts chrome ABOVE the editor and the
	// port's own box starts elsewhere. Subtracting only the scroll (or only the viewport
	// top) leaves the other term in the answer and slices the window a whole band off.
	it('cancels the port offset and the scroll independently', () => {
		// Editor 400px down a page scrolled 900px: the list's client rect reads
		// 400 - 900 = -500, and its content-space top is still 400.
		expect(listTopWithinContent(-500, 0, 900)).toBe(400);
		// The same editor inside an ancestor scroller whose own box starts at 120.
		expect(listTopWithinContent(-380, 120, 900)).toBe(400);
	});

	// Both terms zero is the degenerate reading a stub can produce; it must not be the
	// only one the arithmetic gets right.
	it('is not satisfied by dropping either term', () => {
		const listTop = -500;
		const both = listTopWithinContent(listTop, 120, 900);
		expect(both).not.toBe(listTop - 120); // scroll dropped
		expect(both).not.toBe(listTop + 900); // port offset dropped
		expect(both).toBe(280);
	});
});

describe('effectiveViewportHeight', () => {
	// VR-11: a scope only occupies its intersection with the editor viewport. Windowing
	// every active scope against the full editor height mounts O(viewport × scopes).
	it('returns the full viewport for a scope spanning the whole viewport', () => {
		// viewport [0, 600); scope from -100 to +900 covers it entirely.
		expect(effectiveViewportHeight(0, 600, -100, 1000)).toBe(600);
	});

	it('clips a scope that only partially overlaps the viewport top', () => {
		// viewport [0, 600); scope tops at 400, 1000 tall -> visible band [400, 600) = 200.
		expect(effectiveViewportHeight(0, 600, 400, 1000)).toBe(200);
	});

	it('clips a scope shorter than the viewport to its own height', () => {
		// viewport [0, 600); scope [100, 400) is fully inside -> 300.
		expect(effectiveViewportHeight(0, 600, 100, 300)).toBe(300);
	});

	it('returns zero for a scope entirely below the viewport', () => {
		expect(effectiveViewportHeight(0, 600, 700, 200)).toBe(0);
	});

	it('returns zero for a scope entirely above the viewport', () => {
		expect(effectiveViewportHeight(800, 600, 0, 400)).toBe(0);
	});

	// The aggregate VR-11 guarantee: N scopes tiling the viewport sum to ~one viewport,
	// not N viewports. Reverting to the full editor height (600 each) would give 1800.
	it('keeps total effective viewport bounded across stacked scopes', () => {
		const viewportTop = 0;
		const viewportHeight = 600;
		// Three 300px scopes stacked; only the middle band sits across the viewport.
		const scopes = [
			{ top: -100, height: 300 }, // [-100, 200): visible [0, 200) = 200
			{ top: 200, height: 300 }, // [200, 500): fully visible = 300
			{ top: 500, height: 300 } // [500, 800): visible [500, 600) = 100
		];
		const totalEffective = scopes.reduce(
			(sum, s) => sum + effectiveViewportHeight(viewportTop, viewportHeight, s.top, s.height),
			0
		);
		expect(totalEffective).toBe(600); // exactly one viewport, not 1800
		expect(totalEffective).toBeLessThanOrEqual(viewportHeight * 1.5);
	});
});
