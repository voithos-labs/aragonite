// The strip-container case of the split-separator rule: a definition's body is real child
// blocks, so without a separator the two children re-emit as continuation lines that
// reparse back into one paragraph.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { rebuildFootnoteDefRaw } from '$lib/plugins/footnotes/footnote-definition';
import { splitNode } from '$lib/tree-operations';
import { describeConvergence } from '$lib/testing/parse-convergence';
import { fixtureReading } from '../../harness/fixture-grammar';

describe('footnote definition Enter at the end of the body', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('keeps the typed second child a second child on reparse', () => {
		const doc = parse('[^a]: one\n');
		const def = doc.children[0];
		splitNode(
			{ children: def.children!, ownerKind: def.kind, owner: def, lineEnding: '\n' },
			0,
			'one'.length,
			undefined,
			fixtureReading()
		);
		def.children![1].raw = 'two\n';
		rebuildFootnoteDefRaw(def);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('[^a]: one\n\n    two\n');
	});
});
