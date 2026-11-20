// @vitest-environment jsdom
// A paste over a range that takes every byte of a document lands in what the removal empties,
// and the document keeps the last line ending it had, or none.
// Miss-analysis: every pair row kept a block outside its range, so no paste was answered on the
// document with no blocks a removal of everything leaves, and the core's read off it threw.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, runHistory } from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

it.each([
	['one\n\nthree', 'x', 'x'],
	['one\n\nthree', 'one\n\ntwo', 'one\n\ntwo'],
	['one\n\nthree\n', 'x', 'x\n'],
	['# Title\n\nbody', '- a\n- b', '- a\n- b']
])('%j with every byte selected, pasted %j, is %j', async (source, clip, pasted) => {
	for (const mode of ['source', 'live'] as const) {
		const editor = mountCase(source, mode);
		await editor.settle();
		const last = source.trimEnd().length - source.trimEnd().lastIndexOf('\n') - 1;
		await placeRange(editor, {
			anchor: { path: [0], offset: 0 },
			focus: { path: [1], offset: last }
		});
		const ops: string[] = [];
		editor.instance.getEvents().on('edit', (event) => ops.push(event.op));

		await pasteGesture(editor, { 'text/plain': clip }, 'key');

		expect(editor.source(), mode).toBe(pasted);
		expect(ops, mode).toEqual(['delete', 'paste']);
		await runHistory(editor, 'undo');
		expect(editor.source(), mode).toBe(source);
		await destroyMountedEditors();
	}
});
