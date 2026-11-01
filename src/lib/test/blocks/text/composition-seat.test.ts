// @vitest-environment jsdom
// What one composition captures, from `noteStart` to the commit: the selection it opened over, which
// the commit has already overwritten by the time the composed run arrives. A run at a plain caret is
// the block write's to place and mark, like any insertion; the mode check lives in the block.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createCompositionSeat } from '#lib/components/blocks/text/composition-seat.js';
import { replaceDrawnRange } from '#lib/tree-operations/leaf-range.js';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';

const BOLD = 'Some **bold** text';
const node = parse(`${BOLD}\n`, { scope: 'fragment' }).children[0];
const store = topLevelStore(node, fixtureReading({}, 'live'));

function makeSeat(live: { range: { start: number; end: number } | null }) {
	return createCompositionSeat({
		getNode: () => node,
		getRawSelection: () => live.range,
		storedAs: () => store
	});
}

/** What a typed key over `range` writes, which a composition over it must match. */
function keyOver(range: { start: number; end: number }, typed: string) {
	const edit = replaceDrawnRange(node, range, typed, store);
	return { raw: edit.raw.replace(/\n$/, ''), caret: edit.caret };
}

describe('the window is captured at noteStart, not read at the commit', () => {
	it('replaces the selection the composition opened over', () => {
		const live = { range: { start: 5, end: 13 } as { start: number; end: number } | null };
		const seat = makeSeat(live);
		seat.noteStart();
		live.range = null;
		expect(seat.relocate('Some かん text')).toEqual(keyOver({ start: 5, end: 13 }, 'かん'));
	});

	it('leaves a run at a plain caret to the write, which places it like any insertion', () => {
		const seat = makeSeat({ range: null });
		seat.noteStart();
		expect(seat.relocate('Some **boldかん** text')).toBeNull();
	});

	it('answers null outside a window: before any start, and after noteEnd', () => {
		const seat = makeSeat({ range: { start: 5, end: 13 } });
		expect(seat.relocate('Some かん text')).toBeNull();
		seat.noteStart();
		seat.noteEnd();
		expect(seat.relocate('Some かん text')).toBeNull();
	});
});

describe('a selection captured at noteStart is written as a key over it', () => {
	it('writes the extracted run over the range, as the key would', () => {
		const seat = makeSeat({ range: { start: 7, end: 11 } });
		seat.noteStart();
		expect(seat.relocate('Some **かん** text')).toEqual(keyOver({ start: 7, end: 11 }, 'かん'));
	});

	it('declines a read that is not a replacement of the captured range', () => {
		const seat = makeSeat({ range: { start: 5, end: 13 } });
		seat.noteStart();
		expect(seat.relocate('Xome かん text')).toBeNull();
	});

	// Miss-analysis: every composition row kept the bytes past the range, so none saw the browser
	// take a hidden opener with the selection, as it does at a block's start.
	it('writes the committed run when the browser also took a hidden opener past the range', () => {
		const seat = makeSeat({ range: { start: 7, end: 11 } });
		seat.noteStart();
		seat.noteCommit('かん');
		expect(seat.relocate('Some かん** text')).toEqual(keyOver({ start: 7, end: 11 }, 'かん'));
	});
});
