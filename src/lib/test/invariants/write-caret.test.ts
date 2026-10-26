// The check behind G1.155, on both sides of the written text's ends.
import { describe, it, expect } from 'vitest';
import { checkCaretInWrittenText } from '#lib/invariants/write-caret.js';

describe('checkCaretInWrittenText', () => {
	it('holds for a caret from the text start to its end', () => {
		expect(checkCaretInWrittenText(' ', 0)).toBeNull();
		expect(checkCaretInWrittenText(' ', 1)).toBeNull();
		expect(checkCaretInWrittenText('', 0)).toBeNull();
	});

	it('flags a caret past the end or before the start', () => {
		expect(checkCaretInWrittenText(' ', 3)?.code).toBe('caret-in-written-text');
		expect(checkCaretInWrittenText('ab', -1)?.code).toBe('caret-in-written-text');
	});
});
