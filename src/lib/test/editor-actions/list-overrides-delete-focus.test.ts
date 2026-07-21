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
import type { BlockComponent } from '$lib/block-component';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// Regression: deleteBlock's afterTick clamped the focus index against the
// pre-commit node it captured, which is stale by +1 after the delete. Deleting
// the LAST item then indexed past the new refs and lost the caret. The afterTick
// must read the LIVE node (deps.node) — mirrors table-context's documented rule.

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

		// The real path: ListBlock layers createListOverrides over the nested bundle,
		// so the item-delete runs through the override's deleteBlock.
		const bundle = createStandardNestedActions(
			listState as unknown as BlockListState,
			makeNestedActionsDeps({
				index: 0,
				getNode: liveList,
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			}),
			createListOverrides({
				get index() {
					return 0;
				},
				get node() {
					return liveList();
				},
				get path() {
					return [0];
				},
				state: listState as unknown as BlockListState,
				parentBlockEdit: makeStubBlockEdit(),
				parentContainerEdit: containerEdit
			})
		);

		await bundle.blockEdit.deleteBlock(2);

		expect(liveList().children).toHaveLength(2);
		// New last item (index 1) receives the caret; the deleted index-2 ref does not.
		expect(refs[1].focus).toHaveBeenCalledWith(0);
		expect(refs[2].focus).not.toHaveBeenCalled();
	});
});
