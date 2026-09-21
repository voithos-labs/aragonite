// @vitest-environment jsdom
// A collapsed list returns a fixed `[0, 1)` window instead of running the window math, and
// clamps `isInWindow` and `revealChild` so scrolling into a collapsed body gives up rather than
// hanging (VR-5).
import { describe, it, expect, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCK_PX = 50;

function setup(childCount: number, isCollapsed?: () => boolean) {
	const children = Array.from({ length: childCount }, (_, i) => makePara(`p${i}\n`));
	return mountListWindowing({
		children,
		ids: children.map((_, i) => `b${i}`),
		oracle: fixedOracle(BLOCK_PX),
		listHeight: childCount * BLOCK_PX,
		isCollapsed
	});
}

const CLAMP = { active: true, start: 0, end: 1, topSpacerPx: 0, bottomSpacerPx: 0 };

describe('collapsed window substitution', () => {
	it('clamps to [0,1) when the underlying window would be inactive (small container)', () => {
		const { windowing, cleanup } = setup(4, () => true);
		expect(windowing.window).toEqual(CLAMP);
		cleanup();
	});

	it('clamps to [0,1) with zero spacers when the underlying window is active', () => {
		// 100 blocks of 50px turn windowing on; feeding the math a clamped range would emit a
		// bottom spacer of about 4950px, so the fixed result proves the math is skipped.
		const { windowing, cleanup } = setup(100, () => true);
		expect(windowing.window).toEqual(CLAMP);
		cleanup();
	});

	it('serves a frozen result: one shared singleton backs every collapsed scope', () => {
		const { windowing, cleanup } = setup(4, () => true);
		expect(Object.isFrozen(windowing.window)).toBe(true);
		cleanup();
	});

	it('is byte-identical to the no-option surface when isCollapsed returns false', () => {
		for (const count of [4, 100]) {
			const plain = setup(count);
			const expanded = setup(count, () => false);
			expect(expanded.windowing.window).toEqual(plain.windowing.window);
			plain.cleanup();
			expanded.cleanup();
		}
	});
});

describe('isInWindow clamp', () => {
	it('reports only index 0 in-window while collapsed, even for an inactive-window container', () => {
		// Unclamped, a window with windowing off is [0, n), true for every index, so scrolling into
		// the collapsed body would pass the VR-5 check and then hang.
		const { windowing, cleanup } = setup(4, () => true);
		expect(windowing.isInWindow(0)).toBe(true);
		expect(windowing.isInWindow(1)).toBe(false);
		expect(windowing.isInWindow(3)).toBe(false);
		cleanup();
	});

	it('keeps the inactive all-mounted check when not collapsed', () => {
		const { windowing, cleanup } = setup(4, () => false);
		expect(windowing.isInWindow(3)).toBe(true);
		cleanup();
	});
});

describe('revealChild clamp', () => {
	it('degrades a body-index reveal while collapsed: resolves without scrolling', async () => {
		let collapsed = $state(true);
		const { windowing, cleanup, port } = setup(100, () => collapsed);
		await windowing.revealChild(50);
		expect(port.scrollTop()).toBe(0);

		collapsed = false;
		flushSync();
		await windowing.revealChild(50);
		expect(port.scrollTop()).toBe(50 * BLOCK_PX);
		cleanup();
	});
});

describe('expand after collapse', () => {
	it('measures a child mounted by the expand without waiting for a scroll', async () => {
		let collapsed = $state(true);
		const { windowing, cleanup } = setup(4, () => collapsed);
		collapsed = false;
		flushSync();

		// For a small container the window can be identical either way, so the read has to follow
		// the registration itself rather than a change in the window.
		const applyHeight = vi.fn();
		windowing.registerChild('b1', { readHeight: () => 42, applyHeight });
		await tick();
		expect(applyHeight).toHaveBeenCalledWith(42);
		cleanup();
	});
});
