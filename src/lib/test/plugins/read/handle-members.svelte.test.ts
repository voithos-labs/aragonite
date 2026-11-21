// @vitest-environment jsdom
// The host's handle names its root element, loads a document, and switches the mode and the theme.
// A mode or theme set through the handle stands until its prop next changes, so a host that hands
// every prop over again on each render (the React and Vue wrappers) keeps it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import {
	createEditor,
	type Block,
	type Change,
	type Doc,
	type EditInfo,
	type EditorHandle,
	type Events,
	type Mode,
	type Piece,
	type Selection,
	type SelectionInput,
	type View
} from '#lib/index.js';
import type { UndoEntry } from '#lib/undo/types.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
const handles: EditorHandle[] = [];
afterEach(async () => {
	for (const handle of handles.splice(0)) handle.destroy();
	await destroyMountedEditors();
});

const DOC = 'one\n\ntwo\n';

function mounted(options: Parameters<typeof createEditor>[1] = {}): EditorHandle {
	const target = document.body.appendChild(document.createElement('div'));
	const editor = createEditor(target, { source: DOC, ...options });
	handles.push(editor);
	return editor;
}

const undoSteps = (instance: unknown) =>
	(instance as { __test: { getUndoStack(): { undo: UndoEntry[] } } }).__test.getUndoStack().undo
		.length;

describe('the handle', () => {
	it('names the root element as soon as createEditor returns, and on the component', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		target.append(document.createElement('p'));
		const editor = createEditor(target, { source: DOC });
		handles.push(editor);
		expect(editor.element).toBe(target.querySelector('.editor'));
		const m = mountEditor({ source: DOC });
		await m.settle();
		expect(m.instance.element).toBe(m.target.querySelector('.editor'));
	});

	// A compile-time row too: a type dropped from the main entry fails the type check here.
	it('hands back types the main entry names', () => {
		const editor = mounted();
		const reads: [Doc, Mode, Selection | null, View] = [
			editor.doc,
			editor.mode,
			editor.selection,
			editor.view
		];
		const first: Block = editor.doc.blocks[0];
		const pieces: readonly Piece[] = first.pieces;
		const caret: SelectionInput = 0;
		const changesOf = (info: Events['edit']): readonly Change[] => (info as EditInfo).changes;
		expect([reads[0].text, pieces.length > 0, caret, typeof changesOf]).toEqual([
			DOC,
			true,
			0,
			'function'
		]);
	});

	it('loads a document, clearing undo, heard as load and never as edit', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		typeInto(surfaceAt(m, [0]), 'oneX');
		await m.settle();
		expect(undoSteps(m.instance)).toBe(1);
		const heard: string[] = [];
		m.instance.on('edit', () => heard.push('edit'));
		m.instance.on('load', (load) => heard.push(`load ${load.doc.text}`));
		const doc = m.instance.load('fresh\n');
		await m.settle();
		expect([doc.text, doc.current, m.source(), heard]).toEqual([
			'fresh\n',
			true,
			'fresh\n',
			['load fresh\n']
		]);
		expect(undoSteps(m.instance)).toBe(0);
	});

	it('loads text it already holds, as a new document', async () => {
		const m = mountEditor({ source: DOC });
		await m.settle();
		typeInto(surfaceAt(m, [0]), 'oneX');
		await m.settle();
		const loads: number[] = [];
		m.instance.on('load', (load) => loads.push(load.generation));
		m.instance.load(m.source());
		await m.settle();
		expect([loads.length, undoSteps(m.instance)]).toEqual([1, 0]);
	});

	it('keeps a mode set through it across a render that passes the same prop', async () => {
		const editor = mounted({ presentationMode: 'source' });
		flushSync();
		const modes: string[] = [];
		editor.on('mode', (mode) => modes.push(mode.name));
		editor.setMode('live');
		flushSync();
		editor.update({ presentationMode: 'source' });
		flushSync();
		expect([editor.mode.name, modes]).toEqual(['live', ['live']]);
		editor.update({ presentationMode: 'reading' });
		flushSync();
		expect(editor.mode.name).toBe('reading');
	});

	it('keeps a theme set through it across a render that passes the same prop', async () => {
		const editor = mounted({ theme: 'dark' });
		flushSync();
		editor.setTheme('light');
		flushSync();
		editor.update({ theme: 'dark' });
		flushSync();
		expect([editor.theme, editor.element.dataset.editorTheme]).toEqual(['light', 'light']);
		editor.update({ theme: 'sepia' });
		flushSync();
		expect([editor.theme, editor.element.dataset.editorTheme]).toEqual(['sepia', 'sepia']);
		await settleEditor();
	});
});
