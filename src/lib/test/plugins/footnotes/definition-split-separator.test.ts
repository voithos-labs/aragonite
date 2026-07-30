// A footnote definition's body is real child blocks, so Enter at the end of the
// last one reaches the shared split. Without a separator the two children re-emit
// as `[^a]: one\n    two\n`, whose reparse folds them back into one paragraph —
// the strip-container face of the split-separator class.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { rebuildFootnoteDefRaw } from '$lib/plugins/footnotes/footnote-definition';
import { splitNode } from '$lib/tree-operations';
import { describeConvergence } from '$lib/testing/parse-convergence';

describe('footnote definition Enter at the end of the body', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('keeps the typed second child a second child on reparse', () => {
		const doc = parse('[^a]: one\n');
		const def = doc.children[0];
		splitNode({ children: def.children! }, 0, 'one'.length);
		def.children![1].raw = 'two\n';
		rebuildFootnoteDefRaw(def);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('[^a]: one\n\n    two\n');
	});
});
