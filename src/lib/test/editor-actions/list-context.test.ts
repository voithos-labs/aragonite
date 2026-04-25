import { describe, it, expect } from 'vitest';
import { createListContext } from '../../editor-actions/list-context';
import { registerBlockListState } from '../../reactivity/state-registry';
import { createUndoController } from '../../editor-actions/undo-controller';
import { parse } from '../../core/parser';
import {
	makeBlockListState,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '../harness/editor-actions';
import type { CstNode } from '../../contracts';

const makeDeps = (docChildren: CstNode[]) => makeEditorActionsDeps(docChildren).deps;

// ── splitItemAtOffset descriptor correctness (B1) ──────────────────────────

describe('list-context — splitItemAtOffset', () => {
	it('keeps state ids/refs aligned with item.children after trailing-children split', async () => {
		// `- a\n\n  b\n\n  c\n` is a list with one item whose inner children are
		// three paragraphs. Enter mid-content of the first paragraph splits the
		// item into two items — the original keeps the first half, a new sibling
		// holds the second half plus paragraphs b and c.
		const doc = parse('- a\n\n  b\n\n  c\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const item = list.children![0];
		expect(item.kind).toBe('listItem');
		expect(item.children).toHaveLength(3);

		const listState = makeBlockListState(['item-0']);
		registerBlockListState(list, listState as any);
		const itemState = makeBlockListState(['para-a', 'para-b', 'para-c']);
		registerBlockListState(item, itemState as any);

		const deps = makeDeps([list]);
		const controller = createUndoController(deps);

		const listContext = createListContext({
			get index() {
				return 0;
			},
			get node() {
				return list;
			},
			state: listState as any,
			parentBlockEdit: makeStubBlockEdit(),
			parentFocus: makeStubFocus(),
			parentListContext: undefined,
			controller
		});

		await listContext.splitItemAtOffset(0, 0, 1);

		// Post-split invariant: every BlockListState's id array must match the
		// corresponding node.children length. Drift is the Theme B1 bug.
		expect(item.children).toHaveLength(1);
		expect(itemState.innerBlockIds).toHaveLength(1);
		expect(itemState.innerBlockIds[0]).toBe('para-a');

		expect(list.children).toHaveLength(2);
		expect(listState.innerBlockIds).toHaveLength(2);
		expect(listState.innerBlockIds[0]).toBe('item-0');

		const newItem = list.children![1];
		expect(newItem.kind).toBe('listItem');
		expect(newItem.children).toHaveLength(3);
	});

	it('single-child split preserves the count:1 descriptor path', async () => {
		const doc = parse('- hello\n');
		const list = doc.children[0];
		const item = list.children![0];

		const listState = makeBlockListState(['item-0']);
		registerBlockListState(list, listState as any);
		const itemState = makeBlockListState(['para-a']);
		registerBlockListState(item, itemState as any);

		const deps = makeDeps([list]);
		const controller = createUndoController(deps);

		const listContext = createListContext({
			get index() {
				return 0;
			},
			get node() {
				return list;
			},
			state: listState as any,
			parentBlockEdit: makeStubBlockEdit(),
			parentFocus: makeStubFocus(),
			parentListContext: undefined,
			controller
		});

		await listContext.splitItemAtOffset(0, 0, 3);

		expect(item.children).toHaveLength(1);
		expect(itemState.innerBlockIds).toHaveLength(1);
		expect(itemState.innerBlockIds[0]).toBe('para-a');

		expect(list.children).toHaveLength(2);
		expect(listState.innerBlockIds).toHaveLength(2);
	});
});
