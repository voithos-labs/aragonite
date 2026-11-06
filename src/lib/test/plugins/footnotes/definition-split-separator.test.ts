// The strip-container case of the split-separator rule: a definition's body is real child
// blocks, so without a separator the two children re-emit as continuation lines that
// reparse back into one paragraph.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, serialize } from '#lib';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';

import { splitNode } from '#lib/tree-operations/index.js';
import { describeConvergence } from '#lib/testing/parse-convergence.js';
import { fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

describe('footnote definition Enter at the end of the body', () => {
	beforeEach(() => {
		installPlugins([footnotesPlugin()]);
	});

	it('keeps the typed second child a second child on reparse', () => {
		const doc = parse('[^a]: one\n');
		const def = doc.children[0];
		splitNode(
			{ children: def.children!, owner: def, lineEnding: '\n' },
			0,
			'one'.length,
			createSharingState(),
			fixtureReading()
		);
		def.children![1].raw = 'two\n';
		writeContainerRaw(def, defaultGrammarView);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('[^a]: one\n\n    two\n');
	});
});
