// F9: the conformance kit's fixture contract — the kind at `children[0]`, the kit's sentinel
// on the sweeping side — was load-bearing but stated nowhere, so a plugin author met it as a
// bare assertion failure. The message now carries the contract; this holds it to that.
//
// Miss-analysis: the kit's own suites all supplied conforming fixtures, so no test ever read
// the failure an author gets, and a message that taught nothing could not regress.
import { describe, it, expect } from 'vitest';
import { checkCopyIsRawByteSlice } from '$lib/testing';

describe('checkCopyIsRawByteSlice fixture contract', () => {
	it('accepts a fixture whose kind parses at children[0]', () => {
		expect(() => checkCopyIsRawByteSlice('thematicBreak', '---\n')).not.toThrow();
	});

	it('states the contract when the kind is not the first child', () => {
		expect(() => checkCopyIsRawByteSlice('thematicBreak', 'lead paragraph\n\n---\n')).toThrow(
			/must parse to its kind at children\[0\], and the kit adds its own sentinel block/
		);
	});

	it('names the offending kinds, so the fixture is diagnosable from the message alone', () => {
		expect(() => checkCopyIsRawByteSlice('thematicBreak', 'lead paragraph\n\n---\n')).toThrow(
			/expected "thematicBreak", got "paragraph"/
		);
	});
});
