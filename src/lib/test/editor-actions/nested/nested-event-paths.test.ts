import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createListContext } from '$lib/editor-actions/list-context';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// A list nested in a blockquote: its local index (0) differs from its doc-absolute
// path [1, 0], so a scope-local event path is distinguishable from the absolute one.
function makeNestedList() {
	const harness = makeEditorActionsDeps(parse('pad\n\n> - one\n> - two\n').children);
	const { deps, events } = harness;
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const liveQuote = () => deps.doc.children[1];
	const liveList = () => liveQuote().children![0];

	const quoteBundle = createStandardNestedActions(
		createBlockListState(liveQuote),
		makeNestedActionsDeps({
			index: 1,
			getNode: liveQuote,
			path: [1],
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: rootContainerEdit
			}
		})
	);

	const listState = createBlockListState(liveList);
	// indentItem's destination scope resolves the previous item's state from the registry.
	createBlockListState(() => liveList().children![0]);

	const listContext = createListContext({
		scope: {
			get index() {
				return 0;
			},
			get node() {
				return liveList();
			},
			get path() {
				return [1, 0];
			}
		},
		state: listState,
		parentBlockEdit: quoteBundle.blockEdit,
		parentFocus: quoteBundle.focus,
		parentListContext: undefined,
		controller,
		getPresentationMode: undefined,
		linkRef: undefined
	});

	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	return { deps, listContext, liveList, edits };
}

describe('nested list ops emit doc-absolute event paths', () => {
	it('insertItemAfter resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.insertItemAfter(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});

	it('splitItemAtOffset resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.splitItemAtOffset(0, 0, 2);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});

	it('indentItem resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.indentItem(1);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});
});
