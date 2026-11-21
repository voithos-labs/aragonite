// @vitest-environment jsdom
// The document as a plugin reads it in a mounted editor: a `Doc` per version whose blocks are
// built only when reached, one `Block` per node, and each block's place in the tree.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { PluginsProp } from '#lib/schema/plugin-install.js';
import type { Block } from '#lib/schema/doc-view.js';
import { detailsPlugin } from '#packages/details/src/index.js';
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

	it('leaves a title row out of its children and walk, and carries it as its title', async () => {
		const { editor } = await mounted(DETAILS, [detailsPlugin()]);
		const details = editor.doc.blocks[1];
		expect(details.title).toEqual({
			text: 'Title',
			from: DETAILS.indexOf('Title'),
			to: DETAILS.indexOf('Title') + 'Title'.length
		});
		expect(kinds(details.children)).toEqual(['paragraph']);
		expect(kinds(details.walk())).toEqual([details.type.name, 'paragraph']);
		const row = editor.blockAt(DETAILS.indexOf('Title'))!;
		expect([row.parent, row.index, details.children[0].index]).toEqual([details, -1, 0]);
		expect(editor.doc.blocks[0].title).toBeNull();
	});
});
