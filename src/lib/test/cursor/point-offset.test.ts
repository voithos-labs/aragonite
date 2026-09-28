// @vitest-environment jsdom
// Miss-analysis: only a pre-clamped hit test reached the exact lookup, so no test named the clamp.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { caretOffsetAtPoint, offsetFromViewportPoint } from '../../cursor/point-offset';

// One character per pixel across the box, so an expected offset reads off the x directly.
const BOX = { left: 100, right: 200, top: 50, bottom: 70 };
const TEXT = 'p'.repeat(BOX.right - BOX.left);

type PointProbe = ((x: number, y: number) => Range | null) | undefined;

/** jsdom implements neither point API, so stand in for the browser. */
function setPointProbe(probe: PointProbe): void {
	(document as unknown as { caretRangeFromPoint: PointProbe }).caretRangeFromPoint = probe;
}

/** A one-text-node element whose box is stubbed: jsdom lays nothing out. */
function mountBoxed(): HTMLElement {
	const el = document.createElement('div');
	el.textContent = TEXT;
	// jsdom computes a medium border where no border style is set; a browser computes none.
	el.style.border = '0';
	document.body.appendChild(el);
	el.getBoundingClientRect = () => ({ ...BOX, width: 100, height: 20 }) as DOMRect;
	return el;
}

describe('caretOffsetAtPoint: the nearest offset in one element', () => {
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

	// Miss-analysis: the stubbed box had no padding, so a clamp that stopped at the border passed.
	it('clamps a row inside the border and padding, level with a line, where every OS keeps the column', () => {
		el.style.border = '1px solid';
		el.style.padding = '4px 0';
		caretOffsetAtPoint(el, 140, -500);
		expect(asked).toEqual([{ x: 140, y: BOX.top + 5 + 1 }]);
	});

	// Miss-analysis: every stubbed box had empty side padding, so no case held a hanging marker.
	it('keeps a column in the side padding, where a hanging list marker sits', () => {
		el.style.padding = '4px 20px';
		caretOffsetAtPoint(el, -500, 60);
		expect(asked).toEqual([{ x: BOX.left + 1, y: 60 }]);
	});

	it('clamps above a classic scrollbar, which sits inside the border below the padding', () => {
		Object.defineProperties(el, {
			clientLeft: { value: 0 },
			clientTop: { value: 0 },
			clientWidth: { value: 100 },
			clientHeight: { value: 12 }
		});
		caretOffsetAtPoint(el, 140, 9999);
		expect(asked).toEqual([{ x: 140, y: BOX.top + 12 - 1 }]);
	});

	it('keeps the border box where the padding leaves no room for a point', () => {
		el.style.padding = '10px 0';
		caretOffsetAtPoint(el, 140, -500);
		expect(asked).toEqual([{ x: 140, y: BOX.top + 1 }]);
	});

	it('declines where the element holds no position the browser can name', () => {
		setPointProbe(undefined);
		expect(caretOffsetAtPoint(el, 140, 60)).toBeNull();
	});
});

describe('offsetFromViewportPoint: the exact counterpart', () => {
	afterEach(() => {
		document.body.innerHTML = '';
		setPointProbe(undefined);
	});

	it('declines a point the browser resolves outside the element', () => {
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

	/** Records each point the browser is asked about and answers the offset under its x. */
	function askedOf(el: HTMLElement): { x: number; y: number }[] {
		const asked: { x: number; y: number }[] = [];
		setPointProbe((x, y) => {
			asked.push({ x, y });
			const range = document.createRange();
			range.setStart(el.firstChild!, Math.round(x - BOX.left));
			return range;
		});
		return asked;
	}

	// Miss-analysis: only the nearest lookup clamped rows, so a drag end or shift-click in the
	// padding asked the browser there, and Mac and Linux answered the line's start.
	it('asks about a point in the padding level with the nearest line, keeping its column', () => {
		const el = mountBoxed();
		el.style.padding = '4px 0';
		const asked = askedOf(el);

		expect(offsetFromViewportPoint(el, 140, BOX.top + 2)).toBe(40);
		expect(offsetFromViewportPoint(el, 140, BOX.bottom - 2)).toBe(40);
		expect(asked).toEqual([
			{ x: 140, y: BOX.top + 4 + 1 },
			{ x: 140, y: BOX.bottom - 4 - 1 }
		]);
	});

	it('asks about a point outside the box as it is, so the browser can decline it', () => {
		const el = mountBoxed();
		el.style.padding = '4px 0';
		const asked = askedOf(el);

		offsetFromViewportPoint(el, 140, BOX.top - 10);
		expect(asked).toEqual([{ x: 140, y: BOX.top - 10 }]);
	});
});
