// @vitest-environment jsdom
// Miss-analysis: the command undo suites counted entries and read the bytes back, never the caret
// an entry records, so a toggle or an indent that handed over its landing caret stayed green.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { UndoEntry } from '#lib/undo/types.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { cellAt, installTableLayoutStubs } from './table/mount-table';
import { rangeSelectionOf } from '../support/undo-entry';

beforeAll(() => {
	installLayoutStubs();
	return installTableLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function newestEntry(editor: MountedEditor): UndoEntry {
	const { undo } = (
		editor.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack();
	expect(undo.length).toBeGreaterThan(0);
	return undo[undo.length - 1];
}

interface CommandRoute {
	name: string;
	source: string;
	surface: (editor: MountedEditor) => HTMLElement;
	/** The leaf the surface writes, in document coordinates. */
	path: number[];
	selection: [number, number];
	command: string;
	after: string;
}

// Each command that rewrites a selection's bytes, on each surface that runs it.
const ROUTES: CommandRoute[] = [
	{
		name: 'bold at a paragraph caret',
		source: 'hello world\n',
		surface: (editor) => surfaceAt(editor, [0]),
		path: [0],
		selection: [5, 5],
		command: 'format.toggleStrong',
		after: 'hello**** world\n'
	},
	{
		name: 'bold off over a paragraph selection',
		source: 'plain **words** here\n',
		surface: (editor) => surfaceAt(editor, [0]),
		path: [0],
		selection: [8, 13],
		command: 'format.toggleStrong',
		after: 'plain words here\n'
	},
	{
		name: 'bold at a table cell caret',
		source: '| A | B |\n| --- | --- |\n| hello world | c |\n',
		surface: (editor) => cellAt(editor, 1, 0),
		path: [0, 1, 0],
		selection: [5, 5],
		command: 'format.toggleStrong',
		after: '| A | B |\n| --- | --- |\n| hello**** world | c |\n'
	},
	{
		name: 'indent over a code block selection',
		source: '```\nab\ncd\n```\n',
		surface: (editor) => surfaceAt(editor, [0]),
		path: [0],
		selection: [5, 8],
		command: 'code.indent',
		after: '```\n\tab\n\tcd\n```\n'
	},
	{
		name: 'dedent over a code block selection',
		source: '```\n\tab\n```\n',
		surface: (editor) => surfaceAt(editor, [0]),
		path: [0],
		selection: [6, 8],
		command: 'code.dedent',
		after: '```\nab\n```\n'
	}
];

describe('a command’s undo entry records where its selection began', () => {
	for (const route of ROUTES) {
		it(route.name, async () => {
			const editor = mountEditor({ source: route.source, presentationMode: 'source' });
			selectRange(route.surface(editor), ...route.selection);

			expect(editor.instance.runCommand(route.command)).toBe(true);
			await editor.settle();

			expect(editor.source()).toBe(route.after);
			const point = { path: route.path, offset: route.selection[0] };
			expect(rangeSelectionOf(newestEntry(editor))).toEqual({ anchor: point, focus: point });
		});
	}
});
