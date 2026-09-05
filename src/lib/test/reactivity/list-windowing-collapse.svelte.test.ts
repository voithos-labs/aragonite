// @vitest-environment jsdom
// Collapse clamp: a collapsed scope substitutes a fixed [0,1) WindowResult at the
// returned surface — the window math is bypassed, not fed — and clamps
// isInWindow/revealChild so reveal-into-collapsed degrades instead of hanging (VR-5).
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
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
		// 100×50px activates windowing; feeding the math a clamped slice would emit
		// a ~4950px bottom spacer — the fixed result proves the math is bypassed.
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
		// Unclamped, an inactive window is [0, n) — every index true — so a reveal
		// into the collapsed body would pass the VR-5 membership check and hang.
		const { windowing, cleanup } = setup(4, () => true);
		expect(windowing.isInWindow(0)).toBe(true);
		expect(windowing.isInWindow(1)).toBe(false);
		expect(windowing.isInWindow(3)).toBe(false);
		cleanup();
	});

	it('keeps the inactive all-mounted oracle when not collapsed', () => {
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
	it('drains measurements of children mounted by the expand (batch effect keys on the effective result)', () => {
		let collapsed = $state(true);
		const { windowing, cleanup } = setup(4, () => collapsed);

		// A child mounting on expand registers without bumping reactive state, and for a
		// small container the RAW window result is identical across the flip — so keying
		// the batch effect on it would strand this measurement until the next scroll.
		const applyHeight = vi.fn();
		windowing.registerChild('b1', { readHeight: () => 42, applyHeight });
		flushSync();
		expect(applyHeight).not.toHaveBeenCalled();

		collapsed = false;
		flushSync();
		expect(applyHeight).toHaveBeenCalledWith(42);
		cleanup();
	});
});
