// @vitest-environment jsdom
// The host's handle reads the document as a plugin does: `doc`, `selection`, `mode`, `select` and
// `on`, on the mounted component and on what `createEditor` hands back, which the React and Vue
// wrappers pass on as their ref.
// Miss-analysis: every read row went through a plugin's own editor; the handle's accessors are a
// second path that no row read.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { createEditor, type EditorHandle } from '#lib/index.js';
import type { EditInfo } from '#lib/editor-events.js';
import { cellPoint } from '#lib/selection/primitives.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt } from '../../blocks/table/mount-table';

beforeAll(() => installLayoutStubs());
const handles: EditorHandle[] = [];
afterEach(async () => {
	for (const handle of handles.splice(0)) handle.destroy();
	await destroyMountedEditors();
});

const DOC = 'intro\n\n| a | b |\n| - | - |\n| 1 | 22 |\n';

describe("the component's own handle", () => {
	it('reads a new doc after a write, and the selection again after a caret move', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		const doc = m.instance.doc;
		typeInto(surfaceAt(m, [0]), 'introX');
		await m.settle();
		expect([m.instance.doc === doc, m.instance.doc.text]).toEqual([false, m.source()]);
		placeCaret(surfaceAt(m, [0]), 2);
		document.dispatchEvent(new Event('selectionchange'));
		await m.settle();
		const selection = m.instance.selection;
		expect(selection).toMatchObject({ head: 2, empty: true });
		expect(m.instance.selection).toBe(selection);
		placeCaret(surfaceAt(m, [0]), 4);
		document.dispatchEvent(new Event('selectionchange'));
		await m.settle();
		expect(m.instance.selection).toMatchObject({ head: 4 });
	});

	it('reads a caret in a table cell at its byte', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		placeCaret(cellAt(m, 1, 1, [1]), 1);
		document.dispatchEvent(new Event('selectionchange'));
		await m.settle();
		expect(m.instance.selection).toMatchObject({ head: DOC.indexOf('22') + 1, cells: null });
	});

	// Miss-analysis: every cell row selected cells at both ends; a range from text into a table
	// has one, which read as a byte of the table rather than a cell's.
	it('reads a range from text into a table, the cell end at its text', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		await m.instance.setSelection({ anchor: { path: [0], offset: 1 }, focus: cellPoint([1], 3) });
		await m.settle();
		expect(m.instance.selection).toMatchObject({
			anchor: 1,
			head: DOC.indexOf('22'),
			cells: null
		});
		expect(m.instance.selection!.block!.text).toBe('22');
	});

	it('reads no cells for a range from one table into another', async () => {
		const m = mountEditor({ source: DOC + '\n| c |\n| - |\n| 3 |\n' });
		await m.settle();
		await m.instance.setSelection({ anchor: cellPoint([1], 3), focus: cellPoint([2], 1) });
		await m.settle();
		expect(m.instance.selection).toMatchObject({ head: m.source().indexOf('3 |'), cells: null });
	});
});

describe('the handle createEditor hands back', () => {
	it('hears edits and loads, and selects by bytes', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const editor = createEditor(target, { source: DOC });
		handles.push(editor);
		flushSync();
		await settleEditor();
		const edits: EditInfo[] = [];
		const loads: string[] = [];
		editor.on('edit', (info) => edits.push(info));
		editor.on('load', (load) => loads.push(load.doc.text));
		await editor.select(2);
		expect(editor.selection).toMatchObject({ head: 2, empty: true });
		editor.update({ source: 'fresh\n' });
		flushSync();
		await settleEditor();
		expect([edits.length, loads]).toEqual([0, ['fresh\n']]);
		expect([editor.doc.text, editor.mode.name]).toEqual(['fresh\n', 'source']);
	});
});
