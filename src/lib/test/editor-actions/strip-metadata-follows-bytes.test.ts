// Miss-analysis: every write into a list item's first line kept its marker's width, so no test
// wrote a leading space there, where a reload reads the space as part of a wider marker.
import { beforeEach, describe, it, expect } from 'vitest';
import { installPlugins, parse, serialize } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { commitLeafTextAt } from '#lib/editor-actions/block-edit-core.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { makeTopHarness, type TopHarness } from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

interface Row {
	name: string;
	source: string;
	leaf: number[];
	/** The leaf's new bytes; the document keeps every one of them. */
	written: string;
	after: string;
}

const ROWS: Row[] = [
	{
		name: 'a space after a bullet',
		source: '- a b\n',
		leaf: [0, 0, 0],
		written: ' b\n',
		after: '-  b\n'
	},
	{
		name: 'a space after a number',
		source: '1. a b\n',
		leaf: [0, 0, 0],
		written: ' b\n',
		after: '1.  b\n'
	},
	{
		name: 'a space after a bullet in a quote',
		source: '> - a b\n',
		leaf: [0, 0, 0, 0],
		written: ' b\n',
		after: '> -  b\n'
	},
	{
		name: 'a space after a checkbox',
		source: '- [ ] a b\n',
		leaf: [0, 0, 0],
		written: ' b\n',
		after: '- [ ]  b\n'
	},
	{
		name: 'a space before a checkbox in a plain item',
		source: '- a b\n',
		leaf: [0, 0, 0],
		written: ' [ ] b\n',
		after: '-  [ ] b\n'
	},
	{
		name: 'a space above a continuation line',
		source: '- a b\n  c\n',
		leaf: [0, 0, 0],
		written: ' b\nc\n',
		after: '-  b\n  c\n'
	},
	{
		name: 'a space that moves a nested list out to a sibling item',
		source: '- a b\n  - sub\n',
		leaf: [0, 0, 0],
		written: ' b\n',
		after: '-  b\n  - sub\n'
	},
	{
		name: 'a space that moves a second paragraph out of the list',
		source: '- a b\n\n  c\n',
		leaf: [0, 0, 0],
		written: ' b\n',
		after: '-  b\n\n  c\n'
	},
	{
		name: 'a space that moves a second paragraph out of a list in a quote',
		source: '> - a b\n>\n>   c\n',
		leaf: [0, 0, 0, 0],
		written: ' b\n',
		after: '> -  b\n>\n>   c\n'
	},
	{
		name: 'a quote opened inside a quote',
		source: '> a\n',
		leaf: [0, 0],
		written: '> a\n',
		after: '> > a\n'
	}
];

type Route = (h: TopHarness, leaf: number[], text: string) => Promise<void>;

const ROUTES: [string, Route][] = [
	[
		'typed in place',
		async (h, leaf, text) => {
			const owner = blockNodeAt(h.deps.doc, leaf.slice(0, -1)) as CstNode;
			const lineEnding = documentLineEnding(h.deps.doc);
			const body = { children: owner.children!, owner, lineEnding };
			const write = legalizeWrite(body, leaf[leaf.length - 1], text, 'authored');
			const typing = createLeafTyping(h.deps, h.controller);
			expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
		}
	],
	[
		'committed',
		async (h, leaf, text) => {
			const result = await commitLeafTextAt(h, leaf, text, { snapshotOffset: 0, caret: 0 });
			expect(result.wrote).toBe(true);
		}
	]
];

const toCrlf = (bytes: string): string => bytes.replace(/\n/g, '\r\n');

/** Every node's kind, bytes and metadata, so a leaf keeping a byte its reload moves shows. */
function shapeOf(nodes: readonly CstNode[]): unknown[] {
	return nodes.map((n) => ({
		kind: n.kind,
		trivia: n.leadingTrivia,
		raw: n.raw,
		metadata: n.metadata ?? null,
		children: shapeOf(n.children ?? [])
	}));
}

const reloadShape = (doc: Document): unknown[] => shapeOf(parse(serialize(doc)).children);

describe('a strip container reads its rewritten first line as a reload does', () => {
	for (const [routeName, route] of ROUTES) {
		for (const ending of ['LF', 'CRLF'] as const) {
			const mirror = ending === 'LF' ? (bytes: string) => bytes : toCrlf;
			for (const row of ROWS) {
				it(`${row.name}, ${routeName}, ${ending}`, async () => {
					const h = makeTopHarness(mirror(row.source));

					await route(h, row.leaf, mirror(row.written));

					expect(serialize(h.deps.doc)).toBe(mirror(row.after));
					expect(describeConvergence(h.deps.doc)).toBeNull();
					expect(shapeOf(h.deps.doc.children)).toEqual(reloadShape(h.deps.doc));
				});
			}
		}
	}

	// A plugin strip container's opener line is its own, not a child's, or strips one space only.
	describe('where the first line carries nothing a keystroke can widen', () => {
		beforeEach(() => installPlugins([footnotesPlugin(), admonitionsPlugin()]));

		it.each([
			['a footnote definition', '[^x]: a b\n', [0, 0], ' b\n', '[^x]:  b\n'],
			['an alert', '> [!NOTE]\n> a b\n', [0, 0], ' b\n', '> [!NOTE]\n>  b\n']
		])('%s reads as its reload after a leading space', async (_name, source, leaf, text, after) => {
			const h = makeTopHarness(source);

			await ROUTES[0][1](h, leaf, text);

			expect(serialize(h.deps.doc)).toBe(after);
			expect(shapeOf(h.deps.doc.children)).toEqual(reloadShape(h.deps.doc));
		});
	});

	// Miss-analysis: every spill row checked the tree's shape, none which id each block ended up
	// with, so ids handed out by position moved to the item below.
	it.each(ROUTES)('the items a spill left alone keep their ids, %s', async (_name, route) => {
		const h = makeTopHarness('- a b\n  - sub\n- c\n- d\n');
		const list = h.deps.doc.children[0];
		assignChildIdsDeep(list);
		const [first, c, d] = list.childIds!;

		await route(h, [0, 0, 0], ' b\n');

		const ids = h.deps.doc.children[0].childIds!;
		expect(serialize(h.deps.doc)).toBe('-  b\n  - sub\n- c\n- d\n');
		expect(ids).toHaveLength(4);
		expect([ids[0], ids[2], ids[3]]).toEqual([first, c, d]);
		expect([first, c, d]).not.toContain(ids[1]);
	});

	it.each(ROUTES)(
		'the edited item keeps its id when a paragraph leaves the list, %s',
		async (_name, route) => {
			const h = makeTopHarness('- a b\n\n  c\n');
			const list = h.deps.doc.children[0];
			assignChildIdsDeep(list);
			const [item] = list.childIds!;

			await route(h, [0, 0, 0], ' b\n');

			expect(h.deps.doc.children.map((block) => block.kind)).toEqual(['list', 'paragraph']);
			expect(h.deps.doc.children[0].childIds).toEqual([item]);
		}
	);

	it('undo puts back the item a moved paragraph left', async () => {
		const source = '- a b\n\n  c\n';
		const h = makeTopHarness(source);
		const before = shapeOf(h.deps.doc.children);

		await commitLeafTextAt(h, [0, 0, 0], ' b\n', { snapshotOffset: 0, caret: 0 });
		await createHistoryActions(h.deps, h.controller).requestUndo();

		expect(serialize(h.deps.doc)).toBe(source);
		expect(shapeOf(h.deps.doc.children)).toEqual(before);
	});
});
