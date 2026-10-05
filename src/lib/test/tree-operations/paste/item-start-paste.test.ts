// @vitest-environment jsdom
// Miss-analysis: the to-do paste rows landed headings, which an item's bare marker line holds, and
// never a block that line reads as something else, so no row saw the to-do become a divider.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { metadataOf, type Document } from '$lib/core/nodes';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

/** `pasted` at the start of the first item's text, through the paste dispatcher. */
async function pasteAtItemStart(source: string, pasted: string): Promise<Document> {
	const { deps } = makeEditorActionsDeps(parse(source));
	registerBlockListState(
		deps.doc.children[0],
		makeBlockListState(() => deps.doc.children[0])
	);
	await pasteDispatch(
		{ pastedText: pasted, targetPath: [0, 0, 0], offset: 0 },
		pasteContext({
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(deps, createUndoController(deps))
		})
	);
	return deps.doc;
}

describe('a block pasted at a to-do’s text start', () => {
	it('a line the bare bullet reads as a divider stays the to-do’s text', async () => {
		const doc = await pasteAtItemStart('- [ ] bc\n', '---');

		expect(serialize(doc)).toBe('- [ ] ---\n  bc\n');
		expect(metadataOf(doc.children[0].children![0], 'listItem')).toMatchObject({
			taskItem: true
		});
		expect(describeConvergence(doc)).toBeNull();
	});

	// The bare bullet holds a heading, so the block replaces the text and the box goes with it.
	it('a heading lands as one, and the to-do gives its box up', async () => {
		const doc = await pasteAtItemStart('- [ ] bc\n', '# h');

		expect(serialize(doc)).toBe('- # h\n  bc\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
