// @vitest-environment jsdom
// In a list item a clipboard's leading line endings are Enter at the caret, one each, and the rest
// goes in where Enter left the caret (rulings 34 and 79): at the item's text start, mid-text and at
// its end, a heading's text start, two endings. A quote the item holds is the quote's (ruling 80).
// Miss-analysis: the leading-ending rows put the caret outside lists, where the endings go in at
// the caret as written (ruling 81), and no row asked what Enter does there in an item.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted at `‸`, or (with `enters`) that many Enters then `clip` typed: the bytes. */
async function put(marked: string, mode: PresentationMode, clip: string, enters = 0) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	const field = () => document.activeElement as HTMLElement;
	for (let i = 0; i < enters; i++) {
		await pressHardwareKey(field(), { key: 'Enter' });
		await editor.settle();
	}
	if (enters > 0) await insertBy('hardware key', field(), clip);
	else await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const left = editor.source();
	await destroyMountedEditors();
	return left;
}

const HOSTS: [string, string][] = [
	['an item’s text start', '- ‸alpha\n- b\n'],
	['mid-text', '- al‸pha\n- b\n'],
	['an item’s text end', '- alpha‸\n- b\n'],
	['an ordered item', '1. ‸alpha\n2. b\n'],
	['a nested item', '- a\n  - ‸alpha\n'],
	['a to-do', '- [ ] ‸alpha\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of HOSTS)
		for (const [lead, enters] of [
			['\n', 1],
			['\n\n', 2]
		] as const) {
			it(`${mode}: ${JSON.stringify(lead + 'x')} at ${name} is Enter there, then the text`, async () => {
				expect(await put(marked, mode, `${lead}x`)).toBe(await put(marked, mode, 'x', enters));
			});
		}

// [name, marked, clipboard, the bytes], both modes.
const SPELLED: [string, string, string, string][] = [
	['a heading item’s text start', '- # ‸Title\n- After\n', '\nx', '- \n- # xTitle\n- After\n'],
	['a setext line', '- # ‸Title\n- After\n', '\n===', '- \n- # ===Title\n- After\n'],
	['a quote the item holds', '- > ‸alpha\n- b\n', '\nx', '- > \n  > xalpha\n- b\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, want] of SPELLED)
		it(`${mode}: ${JSON.stringify(clip)} at ${name}`, async () => {
			expect(await put(marked, mode, clip)).toBe(want);
		});
