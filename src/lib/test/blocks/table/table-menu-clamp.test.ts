import { describe, it, expect } from 'vitest';
import { clampMenuToViewport } from '$lib/components/blocks/table/table-menu-model';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 180, height: 220 };

describe('clampMenuToViewport', () => {
	it('leaves a menu that fits at its desired coordinate untouched', () => {
		expect(clampMenuToViewport({ x: 300, y: 200 }, MENU, VIEWPORT)).toEqual({ x: 300, y: 200 });
	});

	it('pulls a right-edge overflow back so the menu stays fully on-screen', () => {
		// x=950 would run the 180px menu 130px off a 1000px-wide viewport.
		const { x } = clampMenuToViewport({ x: 950, y: 200 }, MENU, VIEWPORT);
		expect(x).toBe(1000 - 180 - 8);
	});

	it('pulls a bottom-edge overflow back', () => {
		const { y } = clampMenuToViewport({ x: 300, y: 780 }, MENU, VIEWPORT);
		expect(y).toBe(800 - 220 - 8);
	});

	it('clamps a negative/near-zero coordinate to the margin', () => {
		expect(clampMenuToViewport({ x: -50, y: 2 }, MENU, VIEWPORT)).toEqual({ x: 8, y: 8 });
	});

	it('pins a menu larger than the viewport to the top-left margin', () => {
		expect(clampMenuToViewport({ x: 500, y: 500 }, { width: 1200, height: 900 }, VIEWPORT)).toEqual(
			{ x: 8, y: 8 }
		);
	});
});
