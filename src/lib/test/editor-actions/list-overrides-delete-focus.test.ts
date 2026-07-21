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

// Regression: the item delete's afterTick (now core.deleteInterior) must clamp
// the focus index against the LIVE post-commit children, not a pre-commit node
// captured by value — that reference is stale by +1 after the delete, so deleting
// the LAST item indexed past the new refs and lost the caret.

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

		// The real path: ListBlock layers createListOverrides over the nested bundle;
		// the item-delete falls through to the shared core's deleteInterior, whose
		// afterTick reads the live node — the stale-index caret loss this pins.
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
		// New last item (index 1) receives the caret; the deleted index-2 ref does not.
		expect(refs[1].focus).toHaveBeenCalledWith(0);
		expect(refs[2].focus).not.toHaveBeenCalled();
	});
});
