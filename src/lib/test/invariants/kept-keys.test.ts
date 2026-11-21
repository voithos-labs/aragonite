// G1.230: the predicate holds kept answers equal to asking every top-level block again.
import { describe, expect, it } from 'vitest';
import { checkKeptKeys } from '#lib/invariants/kept-keys.js';

describe('checkKeptKeys', () => {
	it('passes answers equal to a fresh evaluation', () => {
		expect(checkKeptKeys(['', '1 Top\n', ''], ['', '1 Top\n', ''])).toBeNull();
	});

	it('names the first block whose kept answer is stale', () => {
		expect(checkKeptKeys(['', '1 Top\n'], ['', '1 TopX\n'])?.message).toBe(
			'block 1 answers "1 TopX\\n", kept as "1 Top\\n"'
		);
	});

	it('names a count that no longer matches the document', () => {
		expect(checkKeptKeys(['', ''], ['', '', ''])?.code).toBe('kept-keys');
	});
});
