// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '../../../core/serializer';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import {
	makePasteCommit,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import { expectParseConverged } from '../../harness/parse-converged';

// The residue joins the last pasted item through a reparse, so a fence closer can change its kind.
// Miss-analysis: GH #56, the residue branch was driven with paragraph targets only.

describe('container-matching merge reattaches residue through the reparse shared path (GH #56)', () => {
	it('a fence closer landing in the last pasted item re-reads as its own block', async () => {
		const { doc, controller } = makePasteCommit('- ```js\n  code\n  ```\n');
		expect(doc.children[0].children?.[0].children?.[0].kind).toBe('fencedCode');
		registerStubBlockListState(doc.children[0]);

		// Caret after `code`, so the residue is the fence's own closing line.
		await pasteDispatch(
			{ pastedText: '- one\n- two\n', targetPath: [0, 0, 0], offset: 10 },
			pasteContext({
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				crossBlock: true
			})
		);

		const lastItem = doc.children[0].children?.[1];
		expect(lastItem?.children?.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);
		expect(serialize(doc)).toBe('- ```js\n  codeone\n  ```\n- two\n  ```\n');
		expectParseConverged(doc);
	});
});
