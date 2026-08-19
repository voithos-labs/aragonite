// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState
} from '../../harness/editor-actions';
import { expectParseConverged } from '../../harness/parse-converged';

// GH #56: the container-matching merge reattached the target's post-caret residue to the
// last clipboard item's leaf as a bare raw write, so bytes that cross a kind boundary (a
// fence closer landing in a paragraph) left the landed node's kind and children stale.
// Miss-analysis: the residue arm was driven with paragraph targets only, so the reattached
// slice never held another kind's bytes and no pin read the landed item's children.

describe('container-matching merge reattaches residue through the reparse funnel (GH #56)', () => {
	it('a fence closer landing in the last pasted item re-reads as its own block', async () => {
		const doc = parse('- ```js\n  code\n  ```\n');
		expect(doc.children[0].children?.[0].children?.[0].kind).toBe('fencedCode');
		registerStubBlockListState(doc.children[0]);

		// Caret after `code`, so the residue is the fence's own closing line.
		await pasteDispatch(
			{ pastedText: '- one\n- two\n', targetPath: [0, 0, 0], offset: 10 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		const lastItem = doc.children[0].children?.[1];
		expect(lastItem?.children?.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);
		expect(serialize(doc)).toBe('- ```js\n  codeone\n  ```\n- two\n  ```\n');
		expectParseConverged(doc);
	});
});
