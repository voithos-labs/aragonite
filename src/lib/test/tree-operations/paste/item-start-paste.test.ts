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
import { replaceRange } from '$lib/selection/cross-block/range-replace';
import { rangeContext } from '../../selection/cross-block/range-context';

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

/** `pasted` over a range from the first item's text start into the item after it. */
async function pasteOverRangeFromItemStart(source: string, pasted: string): Promise<Document> {
	const { deps } = makeEditorActionsDeps(parse(source));
	const list = () => deps.doc.children[0];
	const item = () => list().children![0];
	registerBlockListState(list(), makeBlockListState(list));
	registerBlockListState(item(), makeBlockListState(item));
	deps.selectionState.enterCrossBlock(
		{ path: [0, 0, 0], offset: 0 },
		{ path: [0, 1, 0], offset: 2 }
	);
	await replaceRange(rangeContext(deps, createUndoController(deps)), {
		kind: 'paste',
		text: pasted
	});
	return deps.doc;
}

describe('a block pasted at a to-do’s text start', () => {
	// Every route that lands blocks in a to-do's first slot passes the one replace write.
	it.each([
		{
			route: 'the paste dispatcher',
			paste: pasteAtItemStart,
			source: '- [ ] bc\n',
			bytes: '- [ ] ---\n  bc\n'
		},
		{
			route: 'a range paste',
			paste: pasteOverRangeFromItemStart,
			source: '- [ ] bc\n- [ ] de\n',
			bytes: '- [ ] ---\n'
		}
	])(
		'a line the bare bullet reads as a divider stays the to-do’s text: $route',
		async ({ paste, source, bytes }) => {
			const doc = await paste(source, '---');

			expect(serialize(doc)).toBe(bytes);
			expect(metadataOf(doc.children[0].children![0], 'listItem')).toMatchObject({
				taskItem: true
			});
			expect(describeConvergence(doc)).toBeNull();
		}
	);

	// The bare bullet holds a heading, so the block replaces the text and the box goes with it.
	it('a heading lands as one, and the to-do gives its box up', async () => {
		const doc = await pasteAtItemStart('- [ ] bc\n', '# h');

		expect(serialize(doc)).toBe('- # h\n  bc\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
