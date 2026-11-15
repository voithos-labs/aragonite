// G1.223: the check passes a line break that runs as one off a title row, and fails the rest.
import { describe, expect, it } from 'vitest';
import { checkBreakLanding } from '#lib/invariants/range-break-landing.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { testReading } from '../range-edit/test-host';

describe('G1.223 a line break over a range breaks a line where it runs', () => {
	const doc = () =>
		readAsOpened(':::tip\nbody\n:::\n\npara\n', {
			grammar: testReading().grammar,
			scope: 'document'
		});

	it('passes a break in a body block and in a top-level block', () => {
		expect(checkBreakLanding(doc(), [0, 1], true)).toBeNull();
		expect(checkBreakLanding(doc(), [1], true)).toBeNull();
	});

	it('fails a title row, and a block whose key breaks no line', () => {
		expect(checkBreakLanding(doc(), [0, 0], true)?.code).toBe('range-break-landing');
		expect(checkBreakLanding(doc(), [1], false)?.code).toBe('range-break-landing');
	});
});
