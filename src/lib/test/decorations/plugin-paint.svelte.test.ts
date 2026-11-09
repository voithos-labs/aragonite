// @vitest-environment jsdom
// A plugin's paint, asked one block at a time: once for each rendered block, again only for a block
// whose bytes changed or that `repaint` names, and stored in the block's own offsets.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor, type PluginError } from '#lib/schema/plugin-unit.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BlockPaint, MarkAt, Paint } from '#lib/decorations/paint.js';
import type { DocumentView } from '#lib/core/node-views.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import type { DecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import type { MarkDecoration } from '#lib/decorations/types.js';
import { takeDevWarns } from '../support/warn-gate';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

type Seam = { getDecorationEngine(): DecorationEngine; getDocument(): DocumentView };

interface Painted {
	m: MountedEditor<Seam>;
	editor: Editor;
	/** Each block's text, once per call to `paint`. */
	asked: string[];
	errors: PluginError[];
}

// Marks each block's first word, with one hover handler for every mark.
const hover = () => {};
const firstWord = (block: Block): Paint[] => {
	const word = /\w+/.exec(block.text);
	if (!word) return [];
	const from = block.byteAt(word.index);
	return [{ type: 'mark', from, to: from + word[0].length, class: 'word', hover }];
};

// `asked` holds each block's text once per call to `paint`, and its type once per `paintContainer`.
async function painted(
	source: string,
	paint = firstWord,
	paintContainer?: (block: Block) => readonly BlockPaint[]
): Promise<Painted> {
	const asked: string[] = [];
	const errors: PluginError[] = [];
	let editor: Editor | undefined;
	const painter = definePluginUnit({
		name: 'painter',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup: (e) => void (editor = e),
			paint: (block) => (asked.push(block.text), paint(block)),
			...(paintContainer && {
				paintContainer: (block: Block) => (asked.push(block.type.name), paintContainer(block))
			})
		})
	});
	const m = mountEditor<Seam>({
		source,
		plugins: [painter],
		onError: (error) => void errors.push(error)
	});
	await m.settle();
	return { m, editor: editor!, asked, errors };
}

function marksAt(m: MountedEditor<Seam>, path: number[]) {
	const node = blockNodeAt(m.instance.__test.getDocument(), path)!;
	return m.instance.__test.getDecorationEngine().paintOf(node, path).marks;
}

describe('when paint is asked', () => {
	it('asks once for each rendered block, then again only for a block an edit changed', async () => {
		const { editor, asked, m } = await painted('one\n\ntwo\n\nthree\n');
		expect([...asked].sort()).toEqual(['one\n', 'three\n', 'two\n']);
		asked.length = 0;
		await editor.edit().replace({ from: 5, to: 8 }, 'TWO').commit();
		await m.settle();
		expect(asked).toEqual(['TWO\n']);
	});

	it('asks again for the blocks `repaint` names, or for every rendered block', async () => {
		const { editor, asked, m } = await painted('one\n\ntwo\n\nthree\n');
		asked.length = 0;
		editor.repaint([editor.blockAt(5)!]);
		await m.settle();
		expect(asked).toEqual(['two\n']);
		asked.length = 0;
		editor.repaint();
		await m.settle();
		expect([...asked].sort()).toEqual(['one\n', 'three\n', 'two\n']);
	});

	it('skips a block that left the document', async () => {
		const { editor, asked, m } = await painted('one\n\ntwo\n\nthree\n');
		const two = editor.blockAt(5)!;
		await editor.edit().replace({ from: 3, to: 8 }, '').commit();
		await m.settle();
		asked.length = 0;
		editor.repaint([two]);
		await m.settle();
		expect(asked).toEqual([]);
	});

	it('keeps the marks it held when a repaint answers the same', async () => {
		const { editor, asked, m } = await painted('one\n\ntwo\n');
		const before = marksAt(m, [1]);
		editor.repaint();
		await m.settle();
		expect(asked.filter((text) => text === 'two\n')).toHaveLength(2);
		expect(marksAt(m, [1])).toBe(before);
	});

	it('keeps a block moved by an insert above, under its new path, without asking it', async () => {
		const { editor, asked, m } = await painted('one\n\ntwo\n');
		asked.length = 0;
		await editor.edit().replace({ from: 0, to: 3 }, 'zero\n\none').commit();
		await m.settle();
		expect(asked).not.toContain('two\n');
		expect(marksAt(m, [2]).map(({ dec }) => dec.path)).toEqual([[2]]);
	});
});

describe('where paint lands', () => {
	// Where a block's text and the document's bytes part: markers between lines, a CRLF, a cell.
	it.each([
		{ shape: "a quote's second line", source: '> one\n> two\n', path: [0, 0], at: 4 },
		{ shape: "a list item's second line", source: '- one\n  two\n', path: [0, 0, 0], at: 4 },
		{ shape: "a nested quote's second line", source: '> > one\n> > two\n', path: [0, 0, 0], at: 4 },
		{ shape: 'a CRLF quote', source: '> one\r\n> two\r\n', path: [0, 0], at: 5 },
		{
			shape: 'a cell a column insert moved',
			source: '| a | b |\n| - | - |\n| one | two |\n',
			edited: '| a | x | b |\n| - | - | - |\n| one | y | two |\n',
			path: [0, 1, 2],
			at: 0
		}
	])("stores a mark in $shape at its offset into the block's text", async (row) => {
		const ranges: MarkAt['range'][] = [];
		const activate = (at: MarkAt) => void ranges.push(at.range);
		const paint = (block: Block): Paint[] => {
			const i = block.text.indexOf('two');
			if (i < 0) return [];
			const from = block.byteAt(i);
			return [{ type: 'mark', from, to: from + 3, class: 'two', activate }];
		};
		const { m, editor } = await painted(row.source, paint);
		if (row.edited) {
			await editor.edit().replace({ from: 0, to: row.source.length }, row.edited).commit();
			await m.settle();
		}
		const source = row.edited ?? row.source;
		const [{ dec }] = marksAt(m, row.path);
		expect([dec.start, dec.end]).toEqual([row.at, row.at + 3]);
		dec.interactive!.onActivate!(dec as MarkDecoration, { anchor: new DOMRect() });
		expect(ranges).toEqual([{ from: source.indexOf('two'), to: source.indexOf('two') + 3 }]);
	});

	it('leaves out paint on a marker or outside its block', async () => {
		const source = '> one\n> two\n\n- item\n';
		const paint = (): Paint[] => [
			{ type: 'mark', from: source.indexOf('> two'), to: source.indexOf('two'), class: 'x' },
			{ type: 'mark', from: 0, to: source.length, class: 'x' }
		];
		const { m } = await painted(source, paint);
		expect(marksAt(m, [0, 0])).toEqual([]);
		expect(marksAt(m, [1, 0, 0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			"plugin 'painter' paints a mark at bytes 6..8, which isn't its block's text; it's left out"
		]);
	});
});

describe('a block holding blocks', () => {
	const source = '- one\n- two\n\n> quote\n';
	const classesAt = (m: MountedEditor<Seam>, path: number[]) => {
		const node = blockNodeAt(m.instance.__test.getDocument(), path)!;
		return m.instance.__test
			.getDecorationEngine()
			.paintOf(node, path)
			.blocks.map((dec) => dec.class);
	};

	it("isn't asked through `paint`, and `paintContainer` classes it", async () => {
		const holder = (): BlockPaint[] => [{ type: 'block', class: 'holder' }];
		const { m, asked } = await painted(source, firstWord, holder);
		for (const path of [[0], [0, 0], [0, 1], [1]]) expect(classesAt(m, path)).toEqual(['holder']);
		expect([...asked].sort()).toEqual(
			['blockquote', 'list', 'listItem', 'listItem', 'one\n', 'quote\n', 'two\n'].sort()
		);
	});

	it("asks `paint` again for an edited item's text alone", async () => {
		const { editor, asked, m } = await painted(source);
		asked.length = 0;
		await editor.edit().replace({ from: 8, to: 11 }, 'TWO').commit();
		await m.settle();
		expect(asked).toEqual(['TWO\n']);
	});

	it('leaves out a mark `paintContainer` hands back, with a warning', async () => {
		const mark = { type: 'mark', from: 0, to: 3, class: 'x' } as unknown as BlockPaint;
		const { m } = await painted('> quote\n', firstWord, () => [mark]);
		expect(marksAt(m, [0])).toEqual([]);
		expect(takeDevWarns().map((w) => w.message)).toEqual([
			"plugin 'painter' paints a mark on a blockquote, whose children paint; it's left out"
		]);
	});
});

describe('when paint fails', () => {
	it('keeps what the block painted last and reports the plugin once', async () => {
		let fails = false;
		const paint = (block: Block): Paint[] => {
			if (fails && block.text === 'two\n') throw new Error('no paint today');
			return firstWord(block);
		};
		const { editor, errors, m } = await painted('one\n\ntwo\n', paint);
		const before = marksAt(m, [1]);
		fails = true;
		editor.repaint();
		await m.settle();
		expect(marksAt(m, [1])).toBe(before);
		expect(errors.map((e) => [e.plugin, e.doing])).toEqual([['painter', 'paint']]);
	});
});

describe('turning a plugin on and off', () => {
	it('adds and drops its paint', async () => {
		const marker = definePluginUnit({
			name: 'marker',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ paint: firstWord })
		});
		const m = mountEditor<Seam>({ source: 'one\n', plugins: [] });
		await m.settle();
		expect(marksAt(m, [0])).toEqual([]);
		m.instance.use([marker]);
		await m.settle();
		expect(marksAt(m, [0]).map(({ dec }) => dec.class)).toEqual(['word']);
		m.instance.use([]);
		await m.settle();
		expect(marksAt(m, [0])).toEqual([]);
	});
});
