// @vitest-environment jsdom
// Miss-analysis: the exact probe was only ever reached through a hit test that had already
// clamped the point, so no test named the clamp, and the one kind that needed it (the parrot's
// reveal) carried its own copy where a regression would show as a caret at byte 0.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { caretOffsetAtPoint, offsetFromViewportPoint } from '../../cursor/point-offset';

// One character per pixel across the box, so an expected offset reads off the x directly.
const BOX = { left: 100, right: 200, top: 50, bottom: 70 };
const TEXT = 'p'.repeat(BOX.right - BOX.left);

type PointProbe = ((x: number, y: number) => Range | null) | undefined;

/** jsdom implements neither point API, so stand in for the engine. */
function setPointProbe(probe: PointProbe): void {
	(document as unknown as { caretRangeFromPoint: PointProbe }).caretRangeFromPoint = probe;
}

/** A one-text-node element whose box is stubbed: jsdom lays nothing out. */
function mountBoxed(): HTMLElement {
	const el = document.createElement('div');
	el.textContent = TEXT;
	document.body.appendChild(el);
	el.getBoundingClientRect = () => ({ ...BOX, width: 100, height: 20 }) as DOMRect;
	return el;
}

describe('caretOffsetAtPoint — the nearest offset in one element', () => {
	let el: HTMLElement;
	let asked: { x: number; y: number }[];

	beforeEach(() => {
		el = mountBoxed();
		asked = [];
		setPointProbe((x, y) => {
			asked.push({ x, y });
			const range = document.createRange();
			range.setStart(el.firstChild!, Math.round(x - BOX.left));
			return range;
		});
	});

	afterEach(() => {
		document.body.innerHTML = '';
		setPointProbe(undefined);
	});

	it('answers the offset under a point inside the box', () => {
		expect(caretOffsetAtPoint(el, 106, 60)).toBe(6);
	});

	it('clamps a point above the box into it rather than declining', () => {
		expect(caretOffsetAtPoint(el, 140, -500)).toBe(40);
		expect(asked).toEqual([{ x: 140, y: BOX.top + 1 }]);
	});

	it('clamps a point past the right edge to the box, one pixel inside', () => {
		caretOffsetAtPoint(el, 9999, 60);
		expect(asked).toEqual([{ x: BOX.right - 1, y: 60 }]);
	});

	it('declines where the element holds no position the engine can name', () => {
		setPointProbe(undefined);
		expect(caretOffsetAtPoint(el, 140, 60)).toBeNull();
	});
});

describe('offsetFromViewportPoint — the exact twin', () => {
	afterEach(() => {
		document.body.innerHTML = '';
		setPointProbe(undefined);
	});

	it('declines a point the engine resolves outside the element', () => {
		const el = mountBoxed();
		const elsewhere = document.createElement('div');
		elsewhere.textContent = 'elsewhere';
		document.body.appendChild(elsewhere);
		setPointProbe(() => {
			const range = document.createRange();
			range.setStart(elsewhere.firstChild!, 3);
			return range;
		});

		expect(offsetFromViewportPoint(el, 140, 60)).toBeNull();
	});
});
