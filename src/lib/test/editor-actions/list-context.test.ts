import { describe, it, expect } from 'vitest';
import { registerBlockListState } from '../../reactivity/state-registry';
import { parse } from '../../core/parser';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '../harness/editor-actions';
import { metadataOf, type CstNode } from '../../core/nodes';

const makeDeps = (docChildren: CstNode[]) => makeEditorActionsDeps(docChildren).deps;

// ── splitItemAtOffset descriptor correctness ───────────────────────────────

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

		const deps = makeDeps([list]);
		const liveItem = () => deps.doc.children[0].children![0];
		const itemState = makeBlockListState(liveItem, ['para-a', 'para-b', 'para-c']);
		registerBlockListState(item, itemState as any);

		const {
			listContext,
			state: listState,
			getNode: liveList
		} = makeListContextAt(deps, 0, {
			ids: ['item-0']
		});

		await listContext.splitItemAtOffset(0, 0, 1);

		// Post-split invariant: every BlockListState's id array must match the
		// corresponding node.children length — drift desyncs the keyed {#each}.
		expect(liveItem().children).toHaveLength(1);
		expect(itemState.innerBlockIds).toHaveLength(1);
		expect(itemState.innerBlockIds[0]).toBe('para-a');

		expect(liveList().children).toHaveLength(2);
		expect(listState.innerBlockIds).toHaveLength(2);
		expect(listState.innerBlockIds[0]).toBe('item-0');

		const newItem = liveList().children![1];
		expect(newItem.kind).toBe('listItem');
		expect(newItem.children).toHaveLength(3);
		// Unordered split: marker mirrors the source, taskMarker stays null.
		expect(newItem.metadata).toMatchObject({ marker: '- ', taskItem: false, taskMarker: null });
		expect(newItem.raw.startsWith('- ')).toBe(true);
	});

	it('single-child split preserves the count:1 descriptor path', async () => {
		const doc = parse('- hello\n');
		const list = doc.children[0];
		const item = list.children![0];

		const deps = makeDeps([list]);
		const liveItem = () => deps.doc.children[0].children![0];
		const itemState = makeBlockListState(liveItem, ['para-a']);
		registerBlockListState(item, itemState as any);

		const {
			listContext,
			state: listState,
			getNode: liveList
		} = makeListContextAt(deps, 0, {
			ids: ['item-0']
		});

		await listContext.splitItemAtOffset(0, 0, 3);

		expect(liveItem().children).toHaveLength(1);
		expect(itemState.innerBlockIds).toHaveLength(1);
		expect(itemState.innerBlockIds[0]).toBe('para-a');

		expect(liveList().children).toHaveLength(2);
		expect(listState.innerBlockIds).toHaveLength(2);
	});

	it('task-item split keeps the task identity (taskItem + taskMarker paired)', async () => {
		const doc = parse('- [ ] foobar\n');
		const list = doc.children[0];
		const item = list.children![0];
		expect(metadataOf(item, 'listItem')).toMatchObject({ taskItem: true, taskMarker: '[ ] ' });

		const deps = makeDeps([list]);
		const liveItem = () => deps.doc.children[0].children![0];
		const itemState = makeBlockListState(liveItem, ['para-0']);
		registerBlockListState(item, itemState as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });

		// Split "foobar" after "foo": the new sibling inherits the task identity.
		await listContext.splitItemAtOffset(0, 0, 3);

		const newItem = liveList().children![1];
		expect(newItem.kind).toBe('listItem');
		// taskItem and taskMarker must agree — a `taskItem:true / taskMarker:null`
		// pair renders plain and trips the dev metadata guard.
		expect(newItem.metadata).toMatchObject({
			taskItem: true,
			taskChecked: false,
			taskMarker: '[ ] '
		});
		expect(newItem.raw).toContain('[ ]');
	});

	it('ordered split bumps the new item marker and renumbers', async () => {
		const doc = parse('1. a\n2. b\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		const item0 = list.children![0];
		registerBlockListState(
			item0,
			makeBlockListState(() => deps.doc.children[0].children![0], ['para-0']) as any
		);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, {
			ids: ['item-0', 'item-1']
		});

		// Split item 0 ("1. a") mid-word: the new sibling takes marker "2. " and
		// the following original item renumbers to "3. ".
		await listContext.splitItemAtOffset(0, 0, 1);

		const items = liveList().children!;
		expect(items).toHaveLength(3);
		expect(items[1].metadata).toMatchObject({ marker: '2. ', taskMarker: null });
		expect(items[2].metadata).toMatchObject({ marker: '3. ' });
	});
});

// ── insertItemAfter marker + task inheritance ──────────────────────────────

describe('list-context — insertItemAfter', () => {
	it('inherits the task marker and bumps an ordered marker', async () => {
		const doc = parse('1. [ ] a\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		registerBlockListState(
			list.children![0],
			makeBlockListState(() => deps.doc.children[0].children![0], ['para-0']) as any
		);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });

		await listContext.insertItemAfter(0);

		const items = liveList().children!;
		expect(items).toHaveLength(2);
		// New item bumps "1. " -> "2. " and inherits the unchecked task marker.
		expect(items[1].metadata).toMatchObject({
			marker: '2. ',
			taskItem: true,
			taskChecked: false,
			taskMarker: '[ ] '
		});
		expect(items[1].raw).toBe('2. [ ] \n');
	});
});

// ── ordered-marker suffix normalization on indent / promote ────────────────

describe('list-context — ordered suffix adopts destination on move', () => {
	const markersOf = (list: CstNode) => list.children!.map((c) => metadataOf(c, 'listItem').marker);

	it('indent: a "1. " item moved into a "1) " sublist adopts ") "', async () => {
		// item0 ("1. a") already holds an ordered "1) x" sublist; item1 ("2. b")
		// indents into it. The moved item must adopt the sublist's ") " suffix —
		// not keep its own ". " — matching paste-absorb.
		const doc = parse('1. a\n   1) x\n2. b\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		const liveSublist = () => deps.doc.children[0].children![0].children![1];
		const sublist = list.children![0].children![1];
		expect(sublist.kind).toBe('list');
		registerBlockListState(sublist, makeBlockListState(liveSublist, ['sub-0']) as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, {
			ids: ['item-0', 'item-1']
		});

		await listContext.indentItem(1);

		// b joined the sublist as its second item, renumbered to "2) " (not "2. ").
		expect(markersOf(liveSublist())).toEqual(['1) ', '2) ']);
		expect(liveSublist().children![1].raw.startsWith('2) ')).toBe(true);
		// Outer list lost item1, item0 stays "1. ".
		expect(markersOf(liveList())).toEqual(['1. ']);
	});

	it('promote: a "1) " sub-item moved to a "1. " outer list adopts ". "', async () => {
		// Two-item sublist so promoting the first leaves a survivor — proving the
		// survivor renumbers within the sublist (") " preserved) while the moved
		// item adopts the outer ". ".
		const doc = parse('1. a\n   1) x\n   2) y\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		const liveSublist = () => deps.doc.children[0].children![0].children![1];
		const sublist = list.children![0].children![1];
		expect(sublist.kind).toBe('list');
		expect(sublist.children).toHaveLength(2);
		registerBlockListState(sublist, makeBlockListState(liveSublist, ['sub-0', 'sub-1']) as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });

		await listContext.promoteNestedItem(0, sublist, 0);

		// x promoted to outer position 1, adopting ". " and renumbering to "2. ".
		expect(markersOf(liveList())).toEqual(['1. ', '2. ']);
		expect(liveList().children![1].raw.startsWith('2. ')).toBe(true);
		// Survivor y stays in the sublist, renumbered to "1) " — ") " preserved.
		expect(markersOf(liveSublist())).toEqual(['1) ']);
	});
});

// ── unordered glyph normalization on indent / promote ───────────────────────

describe('list-context — unordered glyph adopts destination on move', () => {
	const markersOf = (list: CstNode) => list.children!.map((c) => metadataOf(c, 'listItem').marker);

	it('indent: a "- " item moved into a "* " sublist adopts "* "', async () => {
		// item0 ("- a") holds an unordered "* x" sublist; item1 ("- b") indents into
		// it and must adopt the sublist's "* " glyph, not keep its own "- ".
		const doc = parse('- a\n  * x\n- b\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		const liveSublist = () => deps.doc.children[0].children![0].children![1];
		const sublist = list.children![0].children![1];
		expect(sublist.kind).toBe('list');
		registerBlockListState(sublist, makeBlockListState(liveSublist, ['sub-0']) as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, {
			ids: ['item-0', 'item-1']
		});

		await listContext.indentItem(1);

		// b joined the sublist as its second item, adopting the "* " glyph.
		expect(markersOf(liveSublist())).toEqual(['* ', '* ']);
		expect(liveSublist().children![1].raw.startsWith('* ')).toBe(true);
		// Outer list lost item1; item0 stays "- ".
		expect(markersOf(liveList())).toEqual(['- ']);
	});

	it('promote: a "* " sub-item moved to a "- " outer list adopts "- "', async () => {
		// Two-item sublist so promoting the first leaves a survivor that keeps "* ".
		const doc = parse('- a\n  * x\n  * y\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		const liveSublist = () => deps.doc.children[0].children![0].children![1];
		const sublist = list.children![0].children![1];
		expect(sublist.kind).toBe('list');
		expect(sublist.children).toHaveLength(2);
		registerBlockListState(sublist, makeBlockListState(liveSublist, ['sub-0', 'sub-1']) as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });

		await listContext.promoteNestedItem(0, sublist, 0);

		// x promoted to outer position 1, adopting "- ".
		expect(markersOf(liveList())).toEqual(['- ', '- ']);
		expect(liveList().children![1].raw.startsWith('- ')).toBe(true);
		// Survivor y stays in the sublist, keeping "* ".
		expect(markersOf(liveSublist())).toEqual(['* ']);
	});
});
