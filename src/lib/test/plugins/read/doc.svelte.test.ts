// @vitest-environment jsdom
// The document as a plugin reads it in a mounted editor: a `Doc` per version whose blocks are
// built only when reached, one `Block` per node, and each block's place in the tree.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { PluginsProp } from '#lib/schema/plugin-install.js';
import type { Block } from '#lib/schema/doc-view.js';
import { details as detailsPlugin } from '#packages/details/src/index.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarnsOf } from '../../support/warn-gate';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	await destroyMountedEditors();
	disablePerfInstruments();
});

const DOC = 'intro\n\n- ant\n- bee\n\n> quoted\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
const DETAILS = 'intro\n\n<details>\n<summary>Title</summary>\n\nbody\n\n</details>\n';

async function mounted(source: string, plugins: PluginsProp = []) {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader, ...plugins] });
	await m.settle();
	return { editor: editor!, m };
}

const kinds = (blocks: Iterable<Block>) => [...blocks].map((block) => block.type.name);

/** What a framework's reactive state makes of a value held in it (Vue's `ref` and `reactive`): a
 *  proxy over every extensible object reached through it, and a frozen one left as it is. */
function heldReactive<T extends object>(value: T): T {
	if (!Object.isExtensible(value)) return value;
	return new Proxy(value, {
		get(target, key, receiver) {
			const read: unknown = Reflect.get(target, key, receiver);
			return typeof read === 'object' && read !== null ? heldReactive(read) : read;
		}
	});
}

describe('Doc', () => {
	it('lists its top-level blocks as an array, building each only when read', async () => {
		const { editor } = await mounted(DOC);
		enablePerfInstruments();
		resetPerfInstruments();
		const { blocks } = editor.doc;
		expect([Array.isArray(blocks), blocks.length]).toEqual([true, 4]);
		expect(perfSnapshot().blocksBuilt).toBe(0);
		void blocks[2];
		expect(perfSnapshot().blocksBuilt).toBe(1);
		expect(blocks.map((block) => block.type.name)).toEqual(kinds(blocks));
		expect(kinds([...blocks])).toEqual(['paragraph', 'list', 'blockquote', 'table']);
		expect(blocks.indexOf(blocks[3])).toBe(3);
		expect([Object.keys(blocks), blocks]).toEqual([['0', '1', '2', '3'], [...blocks]]);
		expect(blocks[4]).toBeUndefined();
		expect(() => ((blocks as Block[])[0] = blocks[1])).toThrow(TypeError);
	});

	it('walks every block depth first', async () => {
		const { editor } = await mounted(DOC);
		expect(kinds(editor.doc.walk())).toEqual([
			'paragraph',
			'list',
			'listItem',
			'paragraph',
			'listItem',
			'paragraph',
			'blockquote',
			'paragraph',
			'table',
			'tableRow',
			'tableCell',
			'tableCell',
			'tableRow',
			'tableCell',
			'tableCell'
		]);
	});

	it('is one object per version, and reads its line ending', async () => {
		const { editor, m } = await mounted(DOC.replaceAll('\n', '\r\n'));
		const doc = editor.doc;
		expect([editor.doc === doc, doc.current, doc.eol]).toEqual([true, true, '\r\n']);
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect([editor.doc === doc, doc.current, editor.doc.current]).toEqual([false, false, true]);
	});

	it('keeps the text of its version once a write replaces it, read or not', async () => {
		const { editor, m } = await mounted(DOC);
		const read = editor.doc;
		void read.text;
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		const unread = editor.doc;
		typeInto(surfaceAt(m, [0]), 'introXY');
		await m.settle();
		expect([read.text, unread.text, editor.doc.text]).toEqual([
			DOC,
			DOC.replace('intro', 'introX'),
			m.source()
		]);
	});

	it("rebuilds an unread version's text past several writes, blocks added and taken out", async () => {
		const { editor, m } = await mounted(DOC);
		const unread = editor.doc;
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		await pressKeyAt(m, [0], 'introX'.length, { key: 'Enter' });
		await m.settle();
		const second = editor.doc;
		await pressKeyAt(m, [2, 0, 0], 'ant'.length, { key: 'Enter' });
		await m.settle();
		expect(m.source()).not.toBe(DOC);
		expect([unread.text, second.text]).toEqual([DOC, DOC.replace('intro\n', 'introX\n\n')]);
	});

	// Miss-analysis: every row read a replaced version's text once, so none timed what holding an
	// unread `Doc` costs each later key: a copy of the whole record per key.
	it.each([40, 400])(
		"keeps only the replaced block's strings on a key after the doc was read, at %i blocks",
		async (count) => {
			const source = Array.from({ length: count }, (_, i) => `para ${i}`).join('\n\n') + '\n';
			const { editor, m } = await mounted(source);
			void editor.doc.blocks[0];
			enablePerfInstruments();
			resetPerfInstruments();
			typeInto(surfaceAt(m, [1]), 'para 1X');
			await m.settle();
			typeInto(surfaceAt(m, [1]), 'para 1XY');
			await m.settle();
			expect(perfSnapshot().stringsKept).toBeLessThanOrEqual(4);
		}
	);

	// Miss-analysis: the bound came after the chain's rows, and no row made more than a few writes.
	it.each([
		[1024, 'its own text'],
		[1025, 'the text as it stands, with the stale warning']
	])(
		'past %i writes from an unread version, reads %s',
		async (writes) => {
			const { editor, m } = await mounted('one\n');
			const held = editor.doc;
			const el = surfaceAt(m, [0]);
			for (let i = 1; i <= writes; i++) {
				typeInto(el, `one${'x'.repeat(i)}`);
				await m.settle();
			}
			const rebuilt = writes <= 1024;
			expect(held.text).toBe(rebuilt ? 'one\n' : m.source());
			expect(takeDevWarnsOf('stale-doc').length).toBe(rebuilt ? 0 : 1);
		},
		60_000
	);

	// Miss-analysis: a new home; no plugin read a document a write had replaced before.
	it('warns once when a replaced version reads its blocks, which are the document as it stands', async () => {
		const { editor, m } = await mounted(DOC);
		const doc = editor.doc;
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect(doc.blocks[0].text).toBe('introX\n');
		void doc.blockAt(0);
		void [...doc.walk()];
		expect(takeDevWarnsOf('stale-doc').map((w) => w.message)).toEqual([
			'Doc.blocks read a document a write has replaced; read `editor.doc` again after an await'
		]);
	});
});

describe('a block and a doc held in reactive state', () => {
	// Miss-analysis: every row held the read surface in plain variables, never in a framework's
	// state, where a proxy over a block lost its node and one over a doc threw on a private field.
	it('read as they do held plainly', async () => {
		const { editor } = await mounted(DOC);
		const block = editor.blockAt(DOC.indexOf('bee'))!;
		const held = heldReactive({ block, doc: editor.doc, blocks: editor.doc.blocks });
		expect([held.block.from, held.block.parent, held.blocks[1].from]).toEqual([
			DOC.indexOf('bee'),
			block.parent,
			DOC.indexOf('- ant')
		]);
		expect([held.doc.text, held.doc.current, held.doc.blockAt(0)]).toEqual([
			DOC,
			true,
			editor.doc.blocks[0]
		]);
	});
});

describe("a block's place", () => {
	it('is one block per node, wherever it is read from', async () => {
		const { editor } = await mounted(DOC);
		const bee = editor.blockAt(DOC.indexOf('bee'))!;
		expect(editor.blockAt(DOC.indexOf('bee'))).toBe(bee);
		const list = editor.doc.blocks[1];
		expect(list.children[1].children[0]).toBe(bee);
		expect([...editor.doc.walk()].includes(bee)).toBe(true);
	});

	it('reads its parent, its index and whether it is prose', async () => {
		const { editor } = await mounted(DOC);
		const bee = editor.blockAt(DOC.indexOf('bee'))!;
		const item = bee.parent!;
		expect([item.type.name, item.index, bee.index, bee.prose, item.prose]).toEqual([
			'listItem',
			1,
			0,
			true,
			false
		]);
		expect([item.parent, editor.doc.blocks[1].parent, editor.doc.blocks[1].index]).toEqual([
			editor.doc.blocks[1],
			null,
			1
		]);
		const cell = editor.blockAt(DOC.indexOf('2 |'))!;
		expect([cell.type.name, cell.prose, cell.index, cell.parent!.index]).toEqual([
			'tableCell',
			true,
			1,
			1
		]);
	});

	it('walks itself and what it holds', async () => {
		const { editor } = await mounted(DOC);
		expect(kinds(editor.doc.blocks[1].walk())).toEqual([
			'list',
			'listItem',
			'paragraph',
			'listItem',
			'paragraph'
		]);
	});

	// Miss-analysis: the walk left a title row out, so a reader found no reference in a callout's
	// title; no row asked a walk for one.
	it('leaves a title row out of its children, walks it after its container, and carries it as its title', async () => {
		const { editor } = await mounted(DETAILS, [detailsPlugin]);
		const details = editor.doc.blocks[1];
		expect(details.title).toEqual({
			text: 'Title',
			from: DETAILS.indexOf('Title'),
			to: DETAILS.indexOf('Title') + 'Title'.length
		});
		expect(kinds(details.children)).toEqual(['paragraph']);
		const row = editor.blockAt(DETAILS.indexOf('Title'))!;
		expect([...details.walk()]).toEqual([details, row, details.children[0]]);
		expect([...editor.doc.walk()]).toEqual([
			editor.doc.blocks[0],
			details,
			row,
			details.children[0]
		]);
		expect([row.parent, row.index, details.children[0].index]).toEqual([details, -1, 0]);
		expect(editor.doc.blocks[0].title).toBeNull();
	});
});
