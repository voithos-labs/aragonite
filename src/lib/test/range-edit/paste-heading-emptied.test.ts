// @vitest-environment jsdom
// A clipboard of line endings alone over a heading's whole text: the heading gives way, its line
// stays empty, and the caret goes to the line under it, as Enter on the emptied heading leaves it.
// A second ending adds nothing, as Enter there only stacks a line. No dev check fires.
// Miss-analysis: the endings-alone rows stood at carets, never over a range that empties a block.
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

/** A key paste of `clip` over `⟦…⟧`: the bytes, then the bytes once `Z` is typed, no dev check. */
async function landed(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
	const range = { anchor: pointAtByte(doc, from)!, focus: pointAtByte(doc, to)! };
	expect(await placeRange(editor, range)).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const left = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	await destroyMountedEditors();
	return [left, typed];
}

const ROWS: [name: string, marked: string, left: string, typed: string][] = [
	['an ATX heading', '# ⟦Title⟧\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['an ATX heading with a closing run', '# ⟦Title⟧ #\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['a setext heading', '⟦Title⟧\n===\n\nAfter\n', '\n\nAfter\n', '\nZ\n\nAfter\n'],
	['a heading in a quote', '> # ⟦Title⟧\n>\n> After\n', '>\n>\n> After\n', '>\n> Z\n>\n> After\n'],
	['the last heading', 'Top\n\n# ⟦Title⟧\n', 'Top\n\n\n\n', 'Top\n\n\nZ\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, left, typed] of ROWS)
		for (const clip of ['\n', '\n\n'])
			it(`${mode}: ${JSON.stringify(clip)} over ${name}'s whole text: it gives way`, async () => {
				expect(await landed(marked, mode, clip)).toEqual([left, typed]);
			});
