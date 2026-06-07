import { describe, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

// Phase 1 harness proof. Phase 4 (G2.1) supersedes this with the full
// arbGfmDoc / arbRawString round-trip; delete this file then.
describe('fast-check harness smoke — paragraph round-trip', () => {
	it('serialize(parse(src)) === src for simple paragraph sources', () => {
		const safeParagraph = fc
			.stringMatching(/^[A-Za-z0-9 ]{1,40}$/)
			.map((t) => t.trim())
			.filter((t) => t.length > 0)
			.map((t) => t + '\n');
		fc.assert(
			fc.property(safeParagraph, (src) => serialize(parse(src)) === src),
			{ numRuns: 200 }
		);
	});
});
