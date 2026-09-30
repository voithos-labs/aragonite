import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// The list bundle's item replace falls through to the shared block-edit core, so these test the
// two guards the core carries through that fall-through.

function itemNode(text: string): CstNode {
	return parse(`- ${text}\n`).children[0].children![0];
}

describe('list item replace falls through to the shared core', () => {
	it('replace records the caller’s undo offset, never the landing or a hardcoded 0', async () => {
		const h = makeNestedHarness('- a\n- b\n', { listOverrides: true, index: 0 });

		await h.bundle.blockEdit.replaceBlock(
			0,
			[itemNode('x')],
			{ replacementIndex: 0, offset: 4 },
			{ snapshotOffset: 3 }
		);

		const entry = h.deps.undoManager.getStacks().undo.at(-1);
		expect(entry).toBeDefined();
		expect(rangeSelectionOf(entry!).focus.offset).toBe(3);
	});

	it('replace backfills an empty editable-container replacement with a placeholder', async () => {
		const h = makeNestedHarness('- a\n- b\n', { listOverrides: true, index: 0 });

		const emptyItem: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			children: [],
			innerPrefix: '',
			innerSuffix: ''
		} as CstNode;

		await h.bundle.blockEdit.replaceBlock(
			0,
			[emptyItem],
			{ replacementIndex: 0, offset: 0 },
			{ snapshotOffset: 0 }
		);

		const placed = h.getNode().children?.[0];
		expect(placed?.kind).toBe('listItem');
		expect(placed?.children?.length).toBeGreaterThan(0);
	});
});
