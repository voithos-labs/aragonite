import { describe, it, expect } from 'vitest';
import { createListOverrides } from '$lib/editor-actions/list-overrides';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { parse } from '$lib/core/parser';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus,
	mountEveryBlock
} from '$lib/test/harness/editor-actions';
import { CURSOR_END } from '$lib/block-component';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// The delete's caret must be read against the live post-commit children: a node read before the
// commit is one too long, so deleting the last item would aim past the list's end.

describe('list-overrides deleteBlock: the caret after deleting the last item', () => {
	it('lands at the end of the new last item, not a stale index past the list', async () => {
		const { deps, landings } = makeEditorActionsDeps([parse('- a\n- b\n- c\n').children[0]]);
		mountEveryBlock(deps);
		const liveList = () => deps.doc.children[0];
		const listState = makeBlockListState(liveList, ['item-0', 'item-1', 'item-2']);
		registerBlockListState(
			liveList(),
			listState as unknown as Parameters<typeof registerBlockListState>[1]
		);

		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);

		// Driven through the real path: ListBlock layers createListOverrides over the nested
		// bundle, and the item-delete falls through to the shared core's deleteInterior.
		const bundle = createStandardNestedActions(
			listState as unknown as BlockListState,
			makeNestedActionsDeps({
				index: 0,
				getNode: liveList,
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			}),
			createListOverrides({
				scope: {
					get index() {
						return 0;
					},
					get node() {
						return liveList();
					},
					get path() {
						return [0];
					}
				},
				parentBlockEdit: makeStubBlockEdit()
			})
		);

		await bundle.blockEdit.deleteBlock(2, 'before');

		expect(liveList().children).toHaveLength(2);
		expect(landings).toEqual([{ leafPath: [0, 1, 0], offset: CURSOR_END, outcome: 'placed' }]);
	});
});
