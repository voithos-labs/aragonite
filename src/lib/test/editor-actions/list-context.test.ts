import { describe, it, expect, afterEach } from 'vitest';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { parse } from '$lib/core/parser';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';
import { metadataOf, type CstNode } from '$lib/core/nodes';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// Hand-built list fixtures read as stale to the container-raw oracle, and a plural first half is
// one of the split shapes under test.
afterEach(() => allowDevWarns(['invariant:stale-raw', 'tree-ops']));

const makeDeps = (docChildren: CstNode[]) => makeEditorActionsDeps(docChildren).deps;

const markersOf = (list: CstNode) => list.children!.map((c) => metadataOf(c, 'listItem').marker);

// ── splitItemAtOffset descriptor correctness ───────────────────────────────

describe('list-context — splitItemAtOffset', () => {
	it('keeps state ids/refs aligned with item.children after trailing-children split', async () => {
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

		// An id array that drifts from its node.children length desyncs the keyed {#each}.
		expect(liveItem().children).toHaveLength(1);
		expect(itemState.innerBlockIds).toHaveLength(1);
		expect(itemState.innerBlockIds[0]).toBe('para-a');

		expect(liveList().children).toHaveLength(2);
		expect(listState.innerBlockIds).toHaveLength(2);
		expect(listState.innerBlockIds[0]).toBe('item-0');

		const newItem = liveList().children![1];
		expect(newItem.kind).toBe('listItem');
		expect(newItem.children).toHaveLength(3);
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

	// Miss-analysis (GH #98): every split pin here used a single-block first half, so
	// `innerIndex + 1` always WAS the second half and the splice boundary went unobserved.
	it('a plural first half stays whole; only the second half moves to the new item', async () => {
		// Enter at the end of the blank line inside the item's indented code: the first half
		// reparses to [code, blank], and the new item must start at the second half.
		const doc = parse('- x\n\n      a\n\n\n      b\n');
		const list = doc.children[0];
		const item = list.children![0];
		expect(item.children!.map((c) => c.kind)).toEqual(['paragraph', 'indentedCode']);

		const deps = makeDeps([list]);
		const liveItem = () => deps.doc.children[0].children![0];
		const itemState = makeBlockListState(liveItem, ['para-0', 'code-1']);
		registerBlockListState(item, itemState as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });

		await listContext.splitItemAtOffset(0, 1, 7);

		expect(liveItem().children!.map((c) => c.raw)).toEqual(['x\n', '    a\n', '\n']);
		expect(itemState.innerBlockIds).toHaveLength(3);

		const newItem = liveList().children![1];
		expect(newItem.children!.map((c) => c.raw)).toEqual(['    b\n']);
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

		await listContext.splitItemAtOffset(0, 0, 3);

		const newItem = liveList().children![1];
		expect(newItem.kind).toBe('listItem');
		// A `taskItem:true / taskMarker:null` pair renders plain and trips the dev metadata guard.
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
		expect(items[1].metadata).toMatchObject({
			marker: '2. ',
			taskItem: true,
			taskChecked: false,
			taskMarker: '[ ] '
		});
		expect(items[1].raw).toBe('2. [ ] \n');
	});

	// The new item's body is nothing but a line ending, so a defaulted `\n` reaches
	// the document's bytes as a lone LF inside a CRLF list (G4.20).
	it('the new item takes the list’s line ending', async () => {
		const doc = parse('1. a\r\n');
		const list = doc.children[0];

		const deps = makeDeps([list]);
		registerBlockListState(
			list.children![0],
			makeBlockListState(() => deps.doc.children[0].children![0], ['para-0']) as any
		);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: ['item-0'] });
		await listContext.insertItemAfter(0);

		expect(liveList().children![1].raw).toBe('2. \r\n');
		expect(liveList().raw).toBe('1. a\r\n2. \r\n');
	});
});

// ── marker normalization on indent / promote ────────────────────────────────

// Parity with paste-absorb: the DESTINATION list's marker wins over the moved item's own,
// and the origin renumbers around the survivor it keeps.
describe('list-context — a moved item adopts its destination marker', () => {
	it.each([
		{
			name: 'indent: a "1. " item moved into a "1) " sublist adopts ") "',
			source: '1. a\n   1) x\n2. b\n',
			move: 'indent' as const,
			outerIds: ['item-0', 'item-1'],
			subIds: ['sub-0'],
			destMarkers: ['1) ', '2) '],
			originMarkers: ['1. ']
		},
		{
			name: 'promote: a "1) " sub-item moved to a "1. " outer list adopts ". "',
			source: '1. a\n   1) x\n   2) y\n',
			move: 'promote' as const,
			outerIds: ['item-0'],
			subIds: ['sub-0', 'sub-1'],
			destMarkers: ['1. ', '2. '],
			originMarkers: ['1) ']
		},
		{
			name: 'indent: a "- " item moved into a "* " sublist adopts "* "',
			source: '- a\n  * x\n- b\n',
			move: 'indent' as const,
			outerIds: ['item-0', 'item-1'],
			subIds: ['sub-0'],
			destMarkers: ['* ', '* '],
			originMarkers: ['- ']
		},
		{
			name: 'promote: a "* " sub-item moved to a "- " outer list adopts "- "',
			source: '- a\n  * x\n  * y\n',
			move: 'promote' as const,
			outerIds: ['item-0'],
			subIds: ['sub-0', 'sub-1'],
			destMarkers: ['- ', '- '],
			originMarkers: ['* ']
		}
	])('$name', async ({ source, move, outerIds, subIds, destMarkers, originMarkers }) => {
		const list = parse(source).children[0];
		const deps = makeDeps([list]);
		const liveSublist = () => deps.doc.children[0].children![0].children![1];
		const sublist = list.children![0].children![1];
		expect(sublist.kind).toBe('list');
		// A promote needs a survivor left behind to renumber within the sublist.
		expect(sublist.children).toHaveLength(subIds.length);
		registerBlockListState(sublist, makeBlockListState(liveSublist, subIds) as any);

		const { listContext, getNode: liveList } = makeListContextAt(deps, 0, { ids: outerIds });

		if (move === 'indent') await listContext.indentItem(1);
		else await listContext.promoteNestedItem(0, sublist, 0);

		const destination = move === 'indent' ? liveSublist : liveList;
		const origin = move === 'indent' ? liveList : liveSublist;
		expect(markersOf(destination())).toEqual(destMarkers);
		expect(destination().children![1].raw.startsWith(destMarkers[1])).toBe(true);
		expect(markersOf(origin())).toEqual(originMarkers);
	});
});
