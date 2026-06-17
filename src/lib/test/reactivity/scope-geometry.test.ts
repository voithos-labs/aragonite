import { describe, it, expect } from 'vitest';
import { estimateWidth, effectiveViewportHeight } from '../../reactivity/scope-geometry';

describe('estimateWidth', () => {
	// VR-3: a nested scope must estimate at its OWN content width, not the editor
	// root's — the oracle's line-wrap is monotonic in width, so the wider root
	// systematically undercounts wrapped heights at depth.
	it('prefers the scope content element width over the editor root', () => {
		expect(estimateWidth({ clientWidth: 400 }, { clientWidth: 800 })).toBe(400);
	});

	it('falls back to the editor root, then a constant, when the list element is absent', () => {
		expect(estimateWidth(null, { clientWidth: 800 })).toBe(800);
		expect(estimateWidth(null, null)).toBe(800);
	});

	// A zero-width (pre-layout) list element is unusable — fall through rather than
	// estimate every block at one char per line.
	it('falls through a zero-width list element to the root', () => {
		expect(estimateWidth({ clientWidth: 0 }, { clientWidth: 800 })).toBe(800);
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
