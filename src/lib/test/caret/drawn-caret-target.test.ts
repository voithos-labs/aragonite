// What the drawn caret shows for one paint's reads: one named row per reason it hides, steps
// aside for the browser's own caret, or draws a bar, and where the bar lands on the device grid.
// Miss-analysis: the table had no widget-edge or gap rows, since each of those carets drew itself.
import { describe, expect, it } from 'vitest';
import {
	drawnCaretTarget,
	hidesBrowserCaret,
	type DrawnCaretReads
} from '#lib/caret/drawn-caret-target.js';

/** A focused caret in a drawable surface, at x 40.3 on a host whose box starts at (10, 20). */
const DRAWING: DrawnCaretReads = {
	draws: true,
	forcedColors: false,
	reading: false,
	windowFocused: true,
	focused: true,
	store: { crossBlock: false, wholeBlock: false, gapCaret: false, widget: false },
	collapsed: true,
	source: { drawable: true },
	gap: false,
	widgetEdge: null,
	pressed: false,
	besideWidget: false,
	atSoftWrap: false,
	clipped: false,
	atCodeChipEdge: false,
	chip: null,
	caret: { left: 40.3, top: 25, bottom: 45 },
	host: { left: 10, top: 20, scale: 1 },
	devicePixelRatio: 1
};

const read = (change: Partial<DrawnCaretReads>): DrawnCaretReads => ({ ...DRAWING, ...change });
const store = (change: Partial<DrawnCaretReads['store']>): Partial<DrawnCaretReads> => ({
	store: { ...DRAWING.store, ...change }
});

/** The bar a click beside a widget asks for, 1.5px wide at x 52.5 from y 24 to 44. */
const EDGE = { left: 52.5, top: 24, bottom: 44, width: 1.5 };
/** The caret beside the widget, where the range has no box of its own. */
const BESIDE = { besideWidget: true, caret: null };
const AT_GAP = { ...store({ gapCaret: true }), gap: true, caret: null };

const HIDDEN: Array<[string, Partial<DrawnCaretReads>]> = [
	['focus is outside the editor', { focused: false }],
	['the window lost focus', { windowFocused: false }],
	['a range in one block', { collapsed: false }],
	['a cross-block range', store({ crossBlock: true })],
	['a block held whole', store({ wholeBlock: true })],
	['a gap caret while focus is elsewhere', store({ gapCaret: true })],
	['the gap proxy focused with no gap caret held', { gap: true }],
	['a cross-block range over a widget edge', { ...store({ crossBlock: true }), widgetEdge: EDGE }],
	['a widget selected whole', store({ widget: true })],
	['reading mode', { reading: true }]
];

const NATIVE: Array<[string, Partial<DrawnCaretReads>]> = [
	['this pointer or the caret prop draws no caret', { draws: false }],
	['forced colors at a text caret, where the browser shows its own', { forcedColors: true }],
	['the anchor sits outside every registered surface', { source: null }],
	['a composition or a shown inline source owns the caret', { source: { drawable: false } }],
	['the caret sits beside an inline widget no click meant', { besideWidget: true }],
	[
		'forced colors at a widget edge, where the browser shows its own',
		{ forcedColors: true, ...BESIDE, widgetEdge: EDGE }
	],
	['forced colors at a gap, where the browser shows its own', { forcedColors: true, ...AT_GAP }],
	['a composition at a widget edge', { ...BESIDE, widgetEdge: EDGE, source: { drawable: false } }],
	['the caret sits where a line soft-wraps', { atSoftWrap: true }],
	['a scroller inside the block clips the caret out of view', { clipped: true }],
	['the caret sits at a code chip’s edge, and no look says which side', { atCodeChipEdge: true }],
	['the range measures to no rect', { caret: null }],
	['the surface has no host box to draw in', { host: null }]
];

describe('the drawn caret hides', () => {
	it.each(HIDDEN)('when %s', (_, change) => {
		expect(drawnCaretTarget(read(change)).state).toBe('hidden');
	});
});

describe('the drawn caret steps aside for the native one', () => {
	it.each(NATIVE)('when %s', (_, change) => {
		expect(drawnCaretTarget(read(change)).state).toBe('native');
	});

	it('when the pointer draws no caret, even with nothing focused', () => {
		expect(drawnCaretTarget(read({ draws: false, focused: false })).state).toBe('native');
	});
});

describe('the drawn caret draws a bar', () => {
	it('at the caret, relative to its host', () => {
		expect(drawnCaretTarget(DRAWING)).toEqual({
			state: 'text',
			rect: { x: 30, y: 5, height: 20 }
		});
	});

	// The column the letter boundary falls in is where the browser's own caret stands; the ends
	// take every device row the line touches.
	it.each([
		[1, { left: 40.7, top: 25, bottom: 45 }, { x: 30, y: 5, height: 20 }],
		[2, { left: 40.3, top: 25, bottom: 45 }, { x: 30, y: 5, height: 20 }],
		[1.25, { left: 40.9, top: 25.3, bottom: 45.3 }, { x: 30.8, y: 4.8, height: 20.8 }],
		[
			1.5,
			{ left: 40.7, top: 25.5, bottom: 45.5 },
			{ x: 30 + 2 / 3, y: 5 + 1 / 3, height: 20 + 2 / 3 }
		]
	])('on whole device pixels at a device pixel ratio of %s', (devicePixelRatio, caret, want) => {
		const target = drawnCaretTarget(read({ devicePixelRatio, caret }));
		if (target.state !== 'text') throw new Error(`drew ${target.state}`);
		for (const key of ['x', 'y', 'height'] as const) {
			expect(target.rect[key], key).toBeCloseTo(want[key], 6);
		}
	});

	it('in the host’s own units when an ancestor scales the editor', () => {
		const target = drawnCaretTarget(read({ host: { left: 10, top: 20, scale: 2 } }));
		expect(target).toEqual({ state: 'text', rect: { x: 15, y: 2.5, height: 10 } });
	});
});

describe('the drawn caret draws a chip stop', () => {
	// Drawn against the chip's own box, so where the range or the browser put the caret is moot.
	it('at the stop the next letter types at, snapped, whatever the range measured', () => {
		const target = drawnCaretTarget(
			read({ atCodeChipEdge: true, chip: { left: 60.7, top: 24, bottom: 44 } })
		);
		expect(target).toEqual({ state: 'chip', rect: { x: 50, y: 4, height: 20 } });
	});

	it('hides with the rest when the editor loses focus', () => {
		const chip = { left: 60, top: 24, bottom: 44 };
		expect(drawnCaretTarget(read({ chip, focused: false })).state).toBe('hidden');
	});
});

describe('the drawn caret draws where the browser can’t', () => {
	it('at the widget edge a click meant, in the host’s units, its column unsnapped', () => {
		expect(drawnCaretTarget(read({ ...BESIDE, widgetEdge: EDGE }))).toEqual({
			state: 'widget',
			rect: { x: 42.5, y: 4, height: 20, width: 1.5 }
		});
	});

	// A picture's bar takes the box of the text on its line, so its rows land where a text bar's would.
	it('at a widget edge, on the device rows a text caret of that box covers', () => {
		const edge = { left: 52.5, top: 24.4, bottom: 44.4, width: 1.5 };
		const text = drawnCaretTarget(read({ caret: edge }));
		const widget = drawnCaretTarget(read({ ...BESIDE, widgetEdge: edge }));
		if (!('rect' in text) || !('rect' in widget)) throw new Error('no bar');
		expect([widget.rect.y, widget.rect.height]).toEqual([text.rect.y, text.rect.height]);
		expect(widget.rect.x).toBe(42.5);
	});

	it.each([
		['beside a widget', BESIDE],
		['in text, as in a task checkbox', {}],
		['when the caret prop is native', { draws: false }]
	])('nothing during a press the click will move the caret from, %s', (_, change) => {
		const target = drawnCaretTarget(read({ ...change, pressed: true }));
		expect(target).toEqual({ state: 'pressed' });
		expect(hidesBrowserCaret(target), 'the browser’s caret hides too').toBe(true);
	});

	it('across the gap while the gap proxy holds focus, its top a pixel above the boundary', () => {
		expect(drawnCaretTarget(read(AT_GAP))).toEqual({ state: 'gap', y: -1 });
	});

	it('across the gap with its top on a whole device pixel', () => {
		const host = { left: 10, top: 20.3, scale: 1 };
		const target = drawnCaretTarget(read({ ...AT_GAP, host, devicePixelRatio: 1.25 }));
		if (target.state !== 'gap') throw new Error(`drew ${target.state}`);
		expect(target.y).toBeCloseTo(-1.1, 6);
	});

	it.each([
		['the caret prop is native or the pointer coarse', { draws: false }],
		['the editor draws its caret', { draws: true }]
	])('at a widget edge, a gap and a chip stop when %s', (_, change) => {
		expect(drawnCaretTarget(read({ ...BESIDE, widgetEdge: EDGE, ...change })).state).toBe('widget');
		expect(drawnCaretTarget(read({ ...AT_GAP, ...change })).state).toBe('gap');
		const chip = { left: 60, top: 24, bottom: 44 };
		expect(drawnCaretTarget(read({ atCodeChipEdge: true, chip, ...change })).state).toBe('chip');
	});
});
