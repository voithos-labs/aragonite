// @vitest-environment jsdom
// A list of the other kind pasted with its ending on an empty ordered item takes the item's place,
// so the item the ending opens after it takes the emptied item's number (ruling 88): `1. ‸` + `- q⏎`
// is `- q\n1. ‸`. An item with text stays, and the ending's item numbers after it.
// Miss-analysis: the ending rows on an emptied host had an item under it, whose list numbered on,
// so no row asked what number the ending's item takes with nothing under it.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted at `‸`, then a letter: the bytes, no dev check, a fresh read. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const left = editor.source();
	await destroyMountedEditors();
	return left;
}

const ROWS: [string, string, string][] = [
	['a sole item', '1. ‸\n', '- q\n1. Z\n'],
	['a sole item numbered three', '3. ‸\n', '- q\n3. Z\n'],
	['the last item', '1. a\n2. ‸\n', '1. a\n- q\n2. Z\n'],
	['a to-do', '1. [ ] ‸\n', '- q\n1. [ ] Z\n'],
	// The controls: an item under it numbers on; an item with text stays and is numbered past.
	['an item with one under it', '1. ‸\n2. c\n', '- q\n1. Z\n2. c\n'],
	['an item with text', '1. a‸\n', '1. a\n- q\n2. Z\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, want] of ROWS)
		it(`${mode}: a bullet list and its ending on ${name}`, async () => {
			expect(await typedAfter(marked, mode, '- q\n')).toBe(want);
		});
