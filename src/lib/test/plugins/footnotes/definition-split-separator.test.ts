// The strip-container case of the split-separator rule: a definition's body is real child
// blocks, so without a separator the two children re-emit as continuation lines that
// reparse back into one paragraph.
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '#lib';
import { splitNode } from '#lib/tree-operations/index.js';
import { describeConvergence } from '#lib/testing/parse-convergence.js';
import { fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

describe('footnote definition Enter at the end of the body', () => {
	it('keeps the typed second child a second child on reparse', () => {
		const grammar = footnotesGrammar();
		const doc = parse('[^a]: one\n', { grammar });
		const def = doc.children[0];
		splitNode(
			{ children: def.children!, owner: def, lineEnding: '\n' },
			0,
			'one'.length,
			createSharingState(),
			fixtureReading({ grammar })
		);
		def.children![1].raw = 'two\n';
		writeContainerRaw(def, grammar);

		expect(describeConvergence(doc, grammar)).toBeNull();
		expect(serialize(doc)).toBe('[^a]: one\n\n    two\n');
	});
});
