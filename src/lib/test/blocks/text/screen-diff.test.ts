// What a live rewrite may claim it did to the screen: one run in or out at one place.
// Miss-analysis: every caller's rows inserted a run unlike its neighbours, so the check only ever
// tried the first offset where the texts differ, and ` m` after `bold ` failed though it holds.
import { describe, expect, it } from 'vitest';
import { insertsExactly, removesExactly } from '$lib/components/blocks/text/screen-diff';

describe('insertsExactly', () => {
	it('finds a run that fits at more than one offset', () => {
		expect(insertsExactly('bold text', 'bold m text', ' m')).toBe(true);
		expect(insertsExactly('aa', 'aaa', 'a')).toBe(true);
	});

	it('refuses anything but one run in', () => {
		expect(insertsExactly('bold text', 'bold mtext', ' m')).toBe(false);
		expect(insertsExactly('bold text', 'bXld text', 'X')).toBe(false);
	});
});

describe('removesExactly', () => {
	it('finds a run that came out of more than one offset', () => {
		expect(removesExactly('bold m text', 'bold text', ' m')).toBe(true);
	});

	it('refuses anything but one run out', () => {
		expect(removesExactly('bold m text', 'boldtext', ' m')).toBe(false);
	});
});
