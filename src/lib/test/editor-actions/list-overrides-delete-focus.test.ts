import { describe, it, expect, vi } from 'vitest';
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
	makeStubFocus
} from '../harness/editor-actions';
import { CURSOR_START, type BlockComponent } from '$lib/block-component';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// The delete's afterTick must clamp against the LIVE post-commit children: a node
// captured by value is stale by +1, so deleting the LAST item indexes past the refs.

function focusSpyRef(): BlockComponent {
	return {
		focus: vi.fn(),
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

describe('list-overrides deleteBlock — focus after deleting the last item', () => {
	it('lands the caret on the new last item, not a stale index past the refs', async () => {
		const { deps } = makeEditorActionsDeps([parse('- a\n- b\n- c\n').children[0]]);
		const liveList = () => deps.doc.children[0];
		const listState = makeBlockListState(liveList, ['item-0', 'item-1', 'item-2']);
		registerBlockListState(
			liveList(),
			listState as unknown as Parameters<typeof registerBlockListState>[1]
		);

		const refs = [focusSpyRef(), focusSpyRef(), focusSpyRef()];
		listState.innerBlockRefs = [...refs];

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

		await bundle.blockEdit.deleteBlock(2);

		expect(liveList().children).toHaveLength(2);
		expect(refs[1].focus).toHaveBeenCalledWith(CURSOR_START);
		expect(refs[2].focus).not.toHaveBeenCalled();
	});
});
