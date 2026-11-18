// @vitest-environment jsdom
// Lines a paste adds in an item, from a line that spells less of the item's indent than its first
// line does (a lazy line, a short one, the second line of an item that opens on spaces), take the
// item's indent, so what was pasted stays in the item (§ 5.5). A line spelling it whole keeps its
// own spelling (a tab). Then the ending is the item's Enter where the paste left the caret.
// Miss-analysis: every item row's caret line was indented as its item indents, so the continuation
// copied from it was always the item's; none pasted lines from a lazy or short line.
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

/** `clip` pasted at `‸`, then a letter: the bytes, no dev check, a fresh read of them. */
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

// [name, marked, clipboard, the bytes after a letter typed]
const ROWS: [string, string, string, string][] = [
	['a short line', '+ a\n b‸\n', 'x\n\nc', '+ a\n bx\n\n  cZ\n'],
	['a short line, ordered', '1. a\n  b‸\n', 'x\n\nc', '1. a\n  bx\n\n   cZ\n'],
	['a lazy line', '- a\nb‸\n', 'x\n\nc', '- a\nbx\n\n  cZ\n'],
	['a short line, a to-do', '- [ ] a\n b‸\n', 'x\n\nc', '- [ ] a\n bx\n\n  cZ\n'],
	['a short line, the ending', '+ a\n b‸\n> q\n', 'x\n\nc\n', '+ a\n bx\n\n  c\n+ Z\n> q\n'],
	[
		'an item that opens on spaces, a list and its ending',
		'+     code\n  aa‸\n\n    more\n',
		'p\n\n- a\n- b\n',
		'+     code\n  aap\n\n      - a\n      - b\n      - Z\n\n    more\n'
	],
	[
		'the same, a quote after',
		'+     code\n  aa‸\n\n    more\n\n> q\n',
		'p\n\n- a\n- b\n',
		'+     code\n  aap\n\n      - a\n      - b\n      - Z\n\n    more\n\n> q\n'
	],
	// The control: a line indented as its item indents keeps its own spelling.
	['an indented line', '- a\n  b‸\n', 'x\n\nc', '- a\n  bx\n\n  cZ\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of ROWS)
		it(`${mode}: ${name}`, async () => {
			expect(await typedAfter(marked, mode, clip)).toBe(want);
		});
