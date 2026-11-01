// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { checkLiveRangeWritten } from '#lib/invariants/live-range-written.js';
import { createCompositionSeat } from '#lib/components/blocks/text/composition-seat.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

describe('G1.168 checkLiveRangeWritten: no edit over a live selection is left to the browser', () => {
	it('passes an edit the editor wrote, and one over no selection', () => {
		expect(checkLiveRangeWritten({ route: 'key', overSelection: true, written: true })).toBeNull();
		expect(
			checkLiveRangeWritten({ route: 'key', overSelection: false, written: false })
		).toBeNull();
	});

	it('fails an edit over a selection the browser kept', () => {
		expect(
			checkLiveRangeWritten({ route: 'composition', overSelection: true, written: false })?.code
		).toBe('live-range-left-to-browser');
	});

	it('fires at a composition seat that reads the selection but cannot write over it', () => {
		const seat = createCompositionSeat({
			getDisplayText: () => 'Some bold text',
			getRawSelection: () => ({ start: 5, end: 9 })
		});
		takeDevWarns();
		seat.noteStart();
		expect(seat.relocate('Some か text')).toBeNull();
		expect(takeDevWarns().map((warn) => warn.tag)).toEqual(['invariant:live-range-written']);
	});
});
