// @vitest-environment jsdom
// Lines pasted on an empty item's or quote's line that ends a file with no line break take the
// container's markers, as they do where the file ends in one (§ 5.5): that last line, a marker
// over an empty block, is the container's body line and not a line of its own.
// Miss-analysis: the marker rows ended their files in a line break, and the layout reads an open
// last line holding a marker alone as the container's own line, which takes no continuation.
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

/** `clip` pasted at `‸`: the bytes, no dev check, a fresh read of them. */
async function pasted(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const left = editor.source();
	await destroyMountedEditors();
	return left;
}

// [name, marked, clipboard, the bytes]
const ROWS: [string, string, string, string][] = [
	['an empty item', '- ‸', 'one\ntwo', '- one\n  two'],
	['an empty quote line', '> ‸', 'one\ntwo', '> one\n> two'],
	['a last empty item', '- a\n- ‸', 'one\ntwo', '- a\n- one\n  two'],
	['a quote in a quote', '> > ‸', 'one\ntwo', '> > one\n> > two'],
	['an ordered item', '1. ‸', 'one\ntwo', '1. one\n   two'],
	['an empty item, two paragraphs', '- ‸', 'x\n\ny', '- x\n\n  y']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of ROWS) {
		it(`${mode}: ${name} on the open last line keeps its markers`, async () => {
			expect(await pasted(marked, mode, clip)).toBe(want);
		});
		it(`${mode}: ${name} lands as where the file ends in a line break`, async () => {
			expect(await pasted(`${marked}\n`, mode, clip)).toBe(`${want}\n`);
		});
	}
