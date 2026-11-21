// @vitest-environment jsdom
// The selection as a plugin reads and sets it: document bytes past a container's markers, one
// object while nothing moves, and `select` landing a caret, a range, a block or table cells.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const DOC = 'intro\n\n> one\n> two three\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';

async function editorOn(source: string): Promise<{ editor: Editor; m: MountedEditor }> {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return { editor: editor!, m };
}

const bytes = (editor: Editor) => {
	const s = editor.selection;
	return s && [s.anchor, s.head, s.from, s.to, s.empty];
};

describe('editor.selection', () => {
	it("reads a caret and a range in document bytes, past a quote's marker", async () => {
		const { editor, m } = await editorOn(DOC);
		const quoted = surfaceAt(m, [1, 0]);
		const two = 'one\ntwo three\n'.indexOf('two');
		selectRange(quoted, two, two);
		await m.settle();
		const at = DOC.indexOf('two');
		expect(bytes(editor)).toEqual([at, at, at, at, true]);
		expect(editor.selection!.block!.text).toBe('one\ntwo three\n');
		selectRange(quoted, two + 4, two);
		await m.settle();
		expect(bytes(editor)).toEqual([at + 4, at, at, at + 4, false]);
	});

	it('is one object while nothing moves, and null with nothing selected', async () => {
		const { editor, m } = await editorOn(DOC);
		expect(editor.selection).toBeNull();
		selectRange(surfaceAt(m, [0]), 1, 3);
		await m.settle();
		expect(editor.selection).toBe(editor.selection);
	});
});

// jsdom lays nothing out, so `select` resolves false for want of a box in view; the selection lands.
describe('editor.select', () => {
	// Miss-analysis: a new home; a plugin could read the selection in bytes but set it only in paths.
	it('lands a caret at a byte, and a range from anchor to head', async () => {
		const { editor } = await editorOn(DOC);
		const at = DOC.indexOf('three');
		await editor.select(at);
		expect(bytes(editor)).toEqual([at, at, at, at, true]);
		await editor.select({ anchor: at + 5, head: DOC.indexOf('one') });
		expect(bytes(editor)).toEqual([at + 5, DOC.indexOf('one'), DOC.indexOf('one'), at + 5, false]);
	});

	it("takes a block's text whole, and refuses a byte outside the document", async () => {
		const { editor } = await editorOn(DOC);
		const intro = editor.doc.blocks[0];
		await editor.select({ block: intro });
		expect(bytes(editor)).toEqual([0, 5, 0, 5, false]);
		expect(await editor.select(DOC.length + 5)).toBe(false);
	});

	it('selects table cells by row and column, and reads them back so', async () => {
		const { editor } = await editorOn(DOC);
		const table = editor.doc.blocks[2];
		await editor.select({ cells: table, anchor: [0, 1], head: [1, 1] });
		const { cells, head } = editor.selection!;
		expect(cells).toEqual({ table, anchor: [0, 1], head: [1, 1] });
		expect(head).toBe(DOC.indexOf('2 |'));
	});
});
