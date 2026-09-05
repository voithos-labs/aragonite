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

// The container-matching merge splices clipboard text into the TARGET LEAF's raw, and it runs
// upstream of the gate that would force a fenced-code target inline — so the leaf's own write
// rule has to answer here. Miss-analysis: the container-match suite drove paragraph targets
// only, and nothing pinned that this arm reaches an arbitrary kind's bytes. Issue #45's family.

// A list item holding a code block whose last body line is one backtick short of a closer.
const ITEM_WITH_CODE = '- a\n\n  ```js\n  ``\n  code\n  ```\n';

async function pasteInto(doc: ReturnType<typeof parse>, targetPath: number[], text: string) {
	registerStubBlockListState(doc.children[0]);
	await pasteDispatch(
		{ pastedText: text, targetPath, offset: 8 },
		{
			doc,
			blockEdit: makeStubBlockEdit(),
			controller: makeRunningPasteController(),
			undoEntry: 'join'
		}
	);
}

describe('container-matching paste into a leaf with its own write rule', () => {
	it('grows the fence when the spliced item text completes a closer run', async () => {
		const doc = parse(ITEM_WITH_CODE);
		expect(doc.children[0].children?.[0].children?.[1].kind).toBe('fencedCode');

		await pasteInto(doc, [0, 0, 1], '- `\n');

		expect(serialize(doc)).toContain('````js\n  ```\n  code\n  ````\n');
		expectParseConverged(doc);
	});

	it('leaves a splice that mints no closer alone', async () => {
		const doc = parse(ITEM_WITH_CODE);

		await pasteInto(doc, [0, 0, 1], '- z\n');

		expect(serialize(doc)).toContain('```js\n  ``z\n  code\n  ```\n');
		expectParseConverged(doc);
	});
});
