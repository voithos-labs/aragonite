// G1.174: the check passes a typed write with no range owned and fails one under a range.
import { describe, it, expect } from 'vitest';
import { checkTypedWriteOutsideRange } from '#lib/invariants/typed-write-outside-range.js';

describe('G1.174 a typed character lands in a block only with no range owned', () => {
	it('passes a typed write with no range', () => {
		expect(checkTypedWriteOutsideRange(false, 'input')).toBeNull();
	});

	it('fails a typed write under a range', () => {
		expect(checkTypedWriteOutsideRange(true, 'typed-insert')?.code).toBe(
			'typed-write-outside-range'
		);
	});
});
