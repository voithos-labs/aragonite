// @vitest-environment jsdom
// A block pasted with its ending mid-item, at an item's text start or over a paragraph the item
// holds below, that took none of the item's text after the caret (a footnote, a fence, a quote with
// nothing after it on the line) leaves that text in the item: the ending opens one empty line
// between the two, the caret on it. A block that took the text splits it off as the item's Enter.
// Miss-analysis: the host-item rows pasted quotes, which take the text after the caret, so no row
// asked what the ending does after a block that takes none.
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

/** `clip` pasted by the key at `‸` or over `⟦ ⟧`, then `Z` typed: the bytes. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return editor.source();
}

const NOTE = '[^9]: note\n';

// [name, marked, clipboard, the bytes once `Z` is typed]
const ROWS: [string, string, string, string][] = [
	[
		'a footnote mid-item',
		'- aaa\n- bb‸cc\n- ddd\n',
		NOTE,
		'- aaa\n- bb\n\n  [^9]: note\n\n  Z\n\n  cc\n- ddd\n'
	],
	[
		'a footnote at an item’s text start',
		'- ‸alpha\n- after\n',
		NOTE,
		'- [^9]: note\n\n  Z\n\n  alpha\n- after\n'
	],
	[
		'a footnote mid-item, nested',
		'- aaa\n  - bb‸cc\n- ddd\n',
		NOTE,
		'- aaa\n  - bb\n\n    [^9]: note\n\n    Z\n\n    cc\n- ddd\n'
	],
	[
		'a footnote mid-item, in a quote',
		'> - aaa\n> - bb‸cc\n',
		NOTE,
		'> - aaa\n> - bb\n>\n>   [^9]: note\n>\n>   Z\n>\n>   cc\n'
	],
	[
		'a footnote of two paragraphs mid-item',
		'- aaa\n- bb‸cc\n- ddd\n',
		'[^9]: note\n\n    more\n',
		'- aaa\n- bb\n\n  [^9]: note\n\n      more\n\n  Z\n\n  cc\n- ddd\n'
	],
	[
		'a footnote over a range across items',
		'- aaa\n- bb⟦cc\n- dd⟧ee\n',
		NOTE,
		'- aaa\n- bb\n\n  [^9]: note\n\n  Z\n\n  ee\n'
	],
	[
		'a fence mid-item, the same',
		'- aaa\n- bb‸cc\n- ddd\n',
		'```\ncode\n```\n',
		'- aaa\n- bb\n\n  ```\n  code\n  ```\n\n  Z\n\n  cc\n- ddd\n'
	],
	[
		'a quote over the item’s paragraph below, nothing after it on the line',
		'- aaa\n- bb‸\n\n  more\n- ddd\n',
		'> quo\n',
		'- aaa\n- bb\n\n  > quo\n\n  Z\n\n  more\n- ddd\n'
	],
	[
		'a quote that took the text after the caret splits it off as Enter',
		'- aaa\n- bb‸cc\n- ddd\n',
		'> quo\n',
		'- aaa\n- bb\n\n  > quo\n- Zcc\n- ddd\n'
	],
	[
		'a footnote at an item’s end opens the next item',
		'- aaa\n- bb‸\n- ddd\n',
		NOTE,
		'- aaa\n- bb\n\n  [^9]: note\n- Z\n- ddd\n'
	]
];

for (const [name, marked, clip, typed] of ROWS)
	for (const mode of ['source', 'live'] as PresentationMode[])
		it(`${name}, ${mode}`, async () => {
			expect(await typedAfter(marked, mode, clip)).toBe(typed);
		});
