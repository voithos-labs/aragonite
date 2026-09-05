import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { rebuildListItemRaw, rebuildListRaw } from '$lib/schema/container-rebuilders';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// Miss-analysis (GH #220): each list door was pinned alone and only over sublists holding items,
// so no test asked the doors that SEAT an item into a sublist what a childless one means — the
// same shape #202 closed one seam over, in the lift direction.

interface KindShape {
	kind: string;
	children?: KindShape[];
}

const shapeOf = (node: CstNode): KindShape => ({
	kind: node.kind,
	...(node.children ? { children: node.children.map(shapeOf) } : {})
});

/**
 * `1. a\n2. b\n` whose first item holds a matching-ordered sublist with no items. Only a plugin
 * reaches it: by constructing the node, or by splicing out a live sublist's last item.
 */
function listWithChildlessSublist(spelling: 'undefined' | 'empty'): CstNode {
	const list = parse('1. a\n   1. x\n2. b\n').children[0];
	const item = list.children![0];
	const sublist = item.children![1];
	if (spelling === 'empty') {
		sublist.children = [];
		sublist.childIds = [];
	} else {
		delete sublist.children;
		delete sublist.childIds;
	}
	sublist.raw = '';
	rebuildListItemRaw(item);
	rebuildListRaw(list);
	return list;
}

// `[]` is truthy, so it already reaches the sublist scope; `undefined` is the red-first pin and
// `[]` the guard that keeps the two spellings answering alike.
describe.each([{ spelling: 'undefined' as const }, { spelling: 'empty' as const }])(
	'indentItem into a childless matching sublist (children: $spelling)',
	({ spelling }) => {
		it('seats the moved item in the sublist, never under the item holding it', async () => {
			const list = listWithChildlessSublist(spelling);
			const { deps, doc } = makeEditorActionsDeps([list]);
			expect(serialize(doc)).toBe('1. a\n2. b\n');

			const liveList = () => deps.doc.children[0];
			const livePrevItem = () => liveList().children![0];
			const liveSublist = () => livePrevItem().children![1];
			registerBlockListState(list.children![0], makeBlockListState(livePrevItem));
			registerBlockListState(list.children![0].children![1], makeBlockListState(liveSublist));

			const { listContext } = makeListContextAt(deps, 0, { ids: ['item-0', 'item-1'] });
			await listContext.indentItem(1);

			expect(shapeOf(liveList())).toEqual({
				kind: 'list',
				children: [
					{
						kind: 'listItem',
						children: [
							{ kind: 'paragraph' },
							{
								kind: 'list',
								children: [{ kind: 'listItem', children: [{ kind: 'paragraph' }] }]
							}
						]
					}
				]
			});

			// The bytes must reload to the tree that wrote them: an item seated under an item
			// serializes to something no reparse can produce.
			expect(serialize(deps.doc)).toBe('1. a\n   1. b\n');
			expect(shapeOf(parse(serialize(deps.doc)).children[0])).toEqual(shapeOf(liveList()));
		});
	}
);
