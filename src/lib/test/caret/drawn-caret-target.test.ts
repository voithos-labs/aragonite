// What the drawn caret shows for one paint's reads: one named row per reason it hides, steps
// aside for the browser's own caret, or draws a bar, and where the bar lands on the device grid.
import { describe, expect, it } from 'vitest';
import { drawnCaretTarget, type DrawnCaretReads } from '#lib/caret/drawn-caret-target.js';

/** A focused caret in a drawable surface, at x 40.3 on a host whose box starts at (10, 20). */
const DRAWING: DrawnCaretReads = {
	draws: true,
	reading: false,
	windowFocused: true,
	focused: true,
	store: { crossBlock: false, wholeBlock: false, gapCaret: false, widget: false },
	collapsed: true,
	source: { drawable: true },
	besideWidget: false,
	atSoftWrap: false,
	clipped: false,
	misdrawn: false,
	caret: { left: 40.3, top: 25, bottom: 45 },
	host: { left: 10, top: 20, scale: 1 },
	devicePixelRatio: 1
};

const read = (change: Partial<DrawnCaretReads>): DrawnCaretReads => ({ ...DRAWING, ...change });
const store = (change: Partial<DrawnCaretReads['store']>): Partial<DrawnCaretReads> => ({
	store: { ...DRAWING.store, ...change }
});

const HIDDEN: Array<[string, Partial<DrawnCaretReads>]> = [
	['focus is outside the editor', { focused: false }],
	['the window lost focus', { windowFocused: false }],
	['a range in one block', { collapsed: false }],
	['a cross-block range', store({ crossBlock: true })],
	['a block held whole', store({ wholeBlock: true })],
	['a gap caret', store({ gapCaret: true })],
	['a widget selected whole', store({ widget: true })],
	['reading mode', { reading: true }]
];

const NATIVE: Array<[string, Partial<DrawnCaretReads>]> = [
	['this pointer or the caret prop draws no caret', { draws: false }],
	['the anchor sits outside every registered surface', { source: null }],
	['a composition or a shown inline source owns the caret', { source: { drawable: false } }],
	['the caret sits beside an inline widget', { besideWidget: true }],
	['the caret sits where a line soft-wraps', { atSoftWrap: true }],
	['a scroller inside the block clips the caret out of view', { clipped: true }],
	['the engine paints its own caret off the range here', { misdrawn: true }],
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
