// Miss-analysis: every renumber fixture was a list counting up by one, where restarting the count
// at item 1 or stepping by one writes the bytes the author wrote.
// The renumber rule over every tree route that numbers an ordered list: it starts at the route's
// own index, items above keep their bytes, and the step is 0 when the first two numbers match.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt,
	makeNestedHarness
} from '#lib/test/harness/editor-actions.js';
import { mergeListItemIntoPrevious } from '#lib/test/harness/list-merge.js';
import { fixtureGrammar, fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { dissolveItem } from '#lib/tree-operations/list/item-partition.js';
import { makeReorderContainer } from './reorder-harness';
import { SPELLINGS, expectedMarkers, listOf, topMarkers } from './ordered-renumber-spellings';

/** Mounts the top-level list and its items, as the editor does before a list gesture. */
function mountList(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const list = () => deps.doc.children[0];
	list().children!.forEach((_, i) => {
		const item = () => list().children![i];
		registerBlockListState(item(), makeBlockListState(item));
	});
	return { deps, ...makeListContextAt(deps, 0) };
}

type Route = (source: string) => Promise<string>;

const ROUTES: { gesture: string; from: number; items: number; run: Route }[] = [
	{
		gesture: 'Enter at the end of b',
		from: 2,
		items: 5,
		run: async (source) => {
			const h = mountList(source);
			await h.listContext.insertItemAfter(1);
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'Enter at the end of a',
		from: 1,
		items: 5,
		run: async (source) => {
			const h = mountList(source);
			await h.listContext.insertItemAfter(0);
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'Enter inside b',
		from: 2,
		items: 5,
		run: async (source) => {
			const h = mountList(source);
			await h.listContext.splitItemAtOffset(1, 0, 1);
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'Backspace at the start of c',
		from: 2,
		items: 3,
		run: async (source) => {
			const doc = parse(source);
			const list = doc.children[0];
			mergeListItemIntoPrevious(
				list,
				list.children!.slice(),
				2,
				createSharingState(),
				fixtureReading()
			);
			return serialize(doc);
		}
	},
	{
		gesture: 'removing b whole',
		from: 1,
		items: 3,
		run: async (source) => {
			const h = makeNestedHarness(source, { index: 0 });
			await h.bundle.blockEdit.deleteBlock(1, 'Delete');
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'removing a whole',
		from: 0,
		items: 3,
		run: async (source) => {
			const h = makeNestedHarness(source, { index: 0 });
			await h.bundle.blockEdit.deleteBlock(0, 'Delete');
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'Tab on c',
		from: 2,
		items: 3,
		run: async (source) => {
			const h = mountList(source);
			await h.listContext.indentItem(2);
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'Tab on b',
		from: 1,
		items: 3,
		run: async (source) => {
			const h = mountList(source);
			await h.listContext.indentItem(1);
			return serialize(h.deps.doc);
		}
	},
	{
		gesture: 'moving c above b',
		from: 1,
		items: 4,
		run: async (source) => {
			const h = makeReorderContainer(source);
			await h.reorder.moveReorderUnit([0, 2, 0], 1);
			return serialize(h.doc);
		}
	},
	{
		gesture: 'dissolving a (unwrap)',
		from: 0,
		items: 3,
		run: async (source) => serializeBlocks(dissolveItem(listOf(source), 0, fixtureGrammar).blocks)
	},
	{
		gesture: 'dissolving an emptied c (Enter out)',
		from: 2,
		items: 3,
		run: async (source) => {
			const list = listOf(source.replace(/ cc\n/, ' \n'));
			return serializeBlocks(dissolveItem(list, 2, fixtureGrammar).blocks);
		}
	}
];

const serializeBlocks = (blocks: CstNode[]) => blocks.map((b) => b.leadingTrivia + b.raw).join('');

describe('a renumber continues the numbering the author wrote', () => {
	for (const route of ROUTES) {
		describe(route.gesture, () => {
			it.each(SPELLINGS)('%s', async (spelling) => {
				const markers = spelling.split(' ');
				const source =
					['aa', 'bb', 'cc', 'dd'].map((t, i) => `${markers[i]} ${t}`).join('\n') + '\n';
				const out = await route.run(source);
				expect(topMarkers(out)).toEqual(expectedMarkers(markers, route.from, route.items));
			});
		});
	}
});
