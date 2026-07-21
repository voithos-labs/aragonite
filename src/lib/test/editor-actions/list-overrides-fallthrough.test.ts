import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { makeNestedHarness } from '../harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// The list bundle's item delete/replace fall through to the shared block-edit
// core (via the container scope) instead of a hand-rolled override. These pin
// the three guards the core carries that the override lacked, so the fall-through
// can never silently regress them:
//   (i)   a no-op delete discards its snapshot (no dead undo entry),
//   (ii)  a replace seeds the undo snapshot with the focus offset,
//   (iii) an empty editable-container replacement is backfilled with a placeholder.
// (i) is a defensive-contract pin: no real list gesture produces an out-of-range
// index, so the practical delta is nil — but the guard is now uniform with core.

function itemNode(text: string): CstNode {
	return parse(`- ${text}\n`).children[0].children![0];
}

describe('list item delete/replace fall through to the shared core', () => {
	it('a no-op delete (out-of-range item) pushes no dead undo entry', async () => {
		const h = makeNestedHarness('- a\n- b\n- c\n', { listOverrides: true, index: 0 });

		// >1 item, so the bundle commits rather than delegating upward; index 99 makes
		// the underlying delete a no-op. The core discards the snapshot; the override did not.
		await h.bundle.blockEdit.deleteBlock(99);

		expect(h.deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(h.getNode().children).toHaveLength(3);
	});

	it('replace seeds the undo snapshot offset from the focus, not a hardcoded 0', async () => {
		const h = makeNestedHarness('- a\n- b\n', { listOverrides: true, index: 0 });

		await h.bundle.blockEdit.replaceBlock(0, [itemNode('x')], { replacementIndex: 0, offset: 4 });

		const entry = h.deps.undoManager.getStacks().undo.at(-1);
		expect(entry).toBeDefined();
		expect(entry!.selection.focus.offset).toBe(4);
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

		await h.bundle.blockEdit.replaceBlock(0, [emptyItem], { replacementIndex: 0, offset: 0 });

		const placed = h.getNode().children?.[0];
		expect(placed?.kind).toBe('listItem');
		expect(placed?.children?.length).toBeGreaterThan(0);
	});
});
