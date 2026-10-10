// What the drawn caret shows for one paint's reads: one named row per reason it hides, steps
// aside for the browser's own caret, or draws a bar, and where the bar lands on the device grid.
// Miss-analysis: the table had no widget-edge or gap rows, since each of those carets drew itself.
import { describe, expect, it } from 'vitest';
import { drawnCaretTarget, type DrawnCaretReads } from '#lib/caret/drawn-caret-target.js';

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
const EDGE = { box: { left: 52.5, top: 24, bottom: 44, width: 1.5 } };
/** A pointer-down beside a widget, before its click says which edge it meant. */
const PRESSED = { box: null };
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
	it('at the caret, relative to its host, snapped to a device pixel', () => {
		expect(drawnCaretTarget(DRAWING)).toEqual({
			state: 'text',
			rect: { x: 30, y: 5, height: 20 }
		});
	});

	it('on a half-pixel grid at a device pixel ratio of 2', () => {
		const target = drawnCaretTarget(read({ devicePixelRatio: 2 }));
		expect(target).toEqual({ state: 'text', rect: { x: 30.5, y: 5, height: 20 } });
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
			read({ atCodeChipEdge: true, chip: { left: 60.4, top: 24, bottom: 44 } })
		);
		expect(target).toEqual({ state: 'chip', rect: { x: 50, y: 4, height: 20 } });
	});

	it('hides with the rest when the editor loses focus', () => {
		const chip = { left: 60, top: 24, bottom: 44 };
		expect(drawnCaretTarget(read({ chip, focused: false })).state).toBe('hidden');
	});
});

describe('the drawn caret draws where the browser can’t', () => {
	it('at the widget edge a click meant, in the host’s units, unsnapped', () => {
		expect(drawnCaretTarget(read({ ...BESIDE, widgetEdge: EDGE }))).toEqual({
			state: 'widget',
			rect: { x: 42.5, y: 4, height: 20, width: 1.5 }
		});
	});

	it('nothing during a pointer-down beside a widget, with the browser’s caret hidden', () => {
		expect(drawnCaretTarget(read({ ...BESIDE, widgetEdge: PRESSED }))).toEqual({
			state: 'widget',
			rect: null
		});
	});

	it('across the gap while the gap proxy holds focus', () => {
		expect(drawnCaretTarget(read(AT_GAP))).toEqual({ state: 'gap' });
	});

	it.each([
		['the caret prop is native or the pointer coarse', { draws: false }],
		['the editor draws its caret', { draws: true }]
	])('at a widget edge and a gap when %s', (_, change) => {
		expect(drawnCaretTarget(read({ ...BESIDE, widgetEdge: EDGE, ...change })).state).toBe('widget');
		expect(drawnCaretTarget(read({ ...AT_GAP, ...change })).state).toBe('gap');
	});
});
