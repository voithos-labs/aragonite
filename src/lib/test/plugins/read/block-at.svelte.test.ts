// @vitest-environment jsdom
// What a plugin reads of the document: the block at a byte through every container, and that
// block's text and pieces in document bytes, computed only once read.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { builtin } from '#lib/components/block-makers/builtin.js';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	await destroyMountedEditors();
	disablePerfInstruments();
});

const QUOTE = '> one\n> two `code` [link](https://x.dev)\n';
const DOC = `intro\n\n- item\n\n${QUOTE}\n| Name | Role |\n| - | - |\n| Ada Lovelace | dev |\n`;

async function editorOn(source: string): Promise<Editor> {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return editor!;
}

describe('Editor.blockAt', () => {
	it('finds the deepest block at a byte, through a list, a quote and a table', async () => {
		const editor = await editorOn(DOC);
		const at = (needle: string) => editor.blockAt(DOC.indexOf(needle))!;
		expect(at('intro').type.name).toBe('paragraph');
		expect(at('item').text).toBe('item\n');
		expect(at('two').text).toBe('one\ntwo `code` [link](https://x.dev)\n');
		expect([at('Lovelace').type.name, at('Lovelace').text]).toEqual(['tableCell', 'Ada Lovelace']);
	});

	it('answers null outside the document', async () => {
		const editor = await editorOn(DOC);
		const outside = [-1, DOC.length + 1, 0.5].map((at) => editor.blockAt(at));
		expect(outside).toEqual([null, null, null]);
	});

	// Miss-analysis: every read row read a document no write had touched, so a byte map kept past
	// a write answered every one of them.
	it('follows each write above a block, for a block held across them too', async () => {
		const editor = await editorOn(DOC);
		const held = editor.blockAt(DOC.indexOf('two'))!;
		let text = DOC;
		for (const intro of ['introduction', 'in']) {
			const line = text.indexOf('\n');
			const result = await editor.edit().replace({ from: 0, to: line }, intro).commit();
			expect(result).toEqual({ ok: true });
			text = intro + text.slice(line);
			expect(held.from).toBe(text.indexOf('one'));
			expect(editor.blockAt(text.indexOf('Lovelace'))!.text).toBe('Ada Lovelace');
			expect(editor.blockAt(text.length - 2)!.text).toBe('dev');
			expect(editor.blockAt(text.length + 1)).toBeNull();
		}
	});
});

describe("a block's positions", () => {
	it("maps its text to document bytes past a quote's marker, and back", async () => {
		const editor = await editorOn(DOC);
		const block = editor.blockAt(DOC.indexOf('two'))!;
		const twoInText = block.text.indexOf('two');
		expect(block.byteAt(twoInText)).toBe(DOC.indexOf('two'));
		expect(block.offsetAt(DOC.indexOf('two'))).toBe(twoInText);
		expect(block.offsetAt(DOC.indexOf('> two'))).toBeNull();
		expect(block.from).toBe(DOC.indexOf('one'));
	});

	// Miss-analysis: no row read `to` on a block inside a container, where the offset past a
	// block's last byte sits behind the next line's marker, or short of a last child's line ending.
	it('end one past its last byte, whatever the next line starts with', async () => {
		const source = 'one\n\n> two\n>\n> three\n\n- ant\n- bee\n\n| cell |\n| - |\n\nlast';
		const editor = await editorOn(source);
		const held = (word: string) => {
			const block = editor.blockAt(source.indexOf(word))!;
			return source.slice(block.from, block.to);
		};
		expect(['one', 'two', 'three', 'ant', 'bee', 'cell', 'last'].map(held)).toEqual([
			'one\n',
			'two\n',
			'three\n',
			'ant\n',
			'bee\n',
			'cell',
			'last'
		]);
	});

	it('gives each piece its document bytes, a text piece one line at most', async () => {
		const editor = await editorOn(DOC);
		const pieces = editor.blockAt(DOC.indexOf('two'))!.pieces;
		const bytes = pieces.map((p) => DOC.slice(p.from, p.to));
		expect(pieces.map((p) => p.kind)).toEqual(['text', 'text', 'inlineCode', 'text', 'link']);
		expect(bytes).toEqual(['one\n', 'two ', '`code`', ' ', '[link](https://x.dev)']);
		const texts = pieces.filter((p) => p.kind === 'text');
		expect(texts.map((p) => p.text)).toEqual(texts.map((p) => DOC.slice(p.from, p.to)));
		expect(pieces[2].is(builtin.inlines.inlineCode)).toBe(true);
		expect(pieces[4].children.map((p) => DOC.slice(p.from, p.to))).toEqual(['link']);
	});

	it('parses nothing until a piece is read, and the same bytes once', async () => {
		const editor = await editorOn(DOC);
		enablePerfInstruments();
		resetPerfInstruments();
		const block = editor.blockAt(DOC.indexOf('two'))!;
		void [block.text, block.from, block.to];
		expect(perfSnapshot().inlineComputeCount).toBe(0);
		void block.pieces;
		void editor.blockAt(DOC.indexOf('code'))!.pieces;
		expect(perfSnapshot().inlineComputeCount).toBe(1);
	});
});
