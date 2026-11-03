import { describe, it, expect } from 'vitest';
import { checkLiveRangeWritten } from '#lib/invariants/live-range-written.js';

describe('G1.168 checkLiveRangeWritten: no key over a live selection is left to the browser', () => {
	it('fails a key the range-edit step declined over a selection, and passes the rest', () => {
		expect(checkLiveRangeWritten(false)).toBeNull();
		expect(checkLiveRangeWritten(true)?.code).toBe('live-range-left-to-browser');
	});
});
