// The conformance kit's failure message states its fixture contract (the kind at `children[0]`,
// the kit's marker block after it), so a plugin author learns the contract from the failure.
// Miss-analysis: every kit suite supplied conforming fixtures, so none read the failure message.
import { describe, it, expect } from 'vitest';
import { checkCopyIsRawByteSlice } from '#lib/testing.js';

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
			/holds a "paragraph" at \[0\], not the "thematicBreak" under test/
		);
	});
});
