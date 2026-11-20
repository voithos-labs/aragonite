// @vitest-environment jsdom
// Text after the caret never joins a pasted block's last line that holds no text (a closing line,
// a code block, a table, at any depth): it goes on a line of its own under it, set apart where the
// block would read it in. A quote the caret's quote takes in lands as its text pasted alone does.
// Miss-analysis: the rest-after rows pasted a callout or a fence at the top level, so no row ended
// a quote or a list on one, and the rest joined a closing fence that then closed nothing.
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
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
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

/** What a paste of `clip` at `‸` leaves, then that with `Z` typed; no dev check may fire. */
async function pasted(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const after = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return [after, typed];
}

/** `‸` marks the caret; `after` is the source the paste leaves, `typed` it once `Z` is typed. */
const ROWS: [name: string, marked: string, clip: string, after: string, typed: string][] = [
	[
		'top mid, qfence',
		'a‸b\n\nAfter\n',
		'> x\n> ```\n> c\n> ```',
		'a\n\n> x\n> ```\n> c\n> ```\nb\n\nAfter\n',
		'a\n\n> x\n> ```\n> cZ\n> ```\nb\n\nAfter\n'
	],
	[
		'top mid, qcallout',
		'a‸b\n\nAfter\n',
		'> x\n>\n> :::note\n> X\n> :::',
		'a\n\n> x\n>\n> :::note\n> X\n> :::\n\nb\n\nAfter\n',
		'a\n\n> x\n>\n> :::note\n> XZ\n> :::\n\nb\n\nAfter\n'
	],
	[
		'top mid, qtable',
		'a‸b\n\nAfter\n',
		'> x\n>\n> | t |\n> | - |',
		'a\n\n> x\n>\n> | t |\n> | - |\n\nb\n\nAfter\n',
		'a\n\n> x\n>\n> | tZ |\n> | - |\n\nb\n\nAfter\n'
	],
	[
		'top mid, lfence',
		'a‸b\n\nAfter\n',
		'- x\n  ```\n  c\n  ```',
		'a\n\n- x\n  ```\n  c\n  ```\nb\n\nAfter\n',
		'a\n\n- x\n  ```\n  cZ\n  ```\nb\n\nAfter\n'
	],
	[
		'quoted note, q callout',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		'> :::note\n> X\n> :::',
		'> :::note\n> a\n>\n> > :::note\n> > X\n> > :::\n>\n> b\n> :::\n\nAfter\n',
		'> :::note\n> a\n>\n> > :::note\n> > XZ\n> > :::\n>\n> b\n> :::\n\nAfter\n'
	],
	[
		'item note, i callout',
		'- :::note\n  a‸b\n  :::\n- after\n',
		'- :::note\n  X\n  :::',
		'- :::note\n  a\n\n  - :::note\n    X\n    :::\n\n  b\n  :::\n- after\n',
		'- :::note\n  a\n\n  - :::note\n    XZ\n    :::\n\n  b\n  :::\n- after\n'
	],
	[
		'top mid, qfence+e',
		'a‸b\n\nAfter\n',
		'> x\n> ```\n> c\n> ```\n',
		'a\n\n> x\n> ```\n> c\n> ```\n\nb\n\nAfter\n',
		'a\n\n> x\n> ```\n> c\n> ```\n\nZ\n\nb\n\nAfter\n'
	],
	[
		'top mid, qtable+e',
		'a‸b\n\nAfter\n',
		'> x\n>\n> | t |\n> | - |\n',
		'a\n\n> x\n>\n> | t |\n> | - |\n\nb\n\nAfter\n',
		'a\n\n> x\n>\n> | t |\n> | - |\n\nZ\n\nb\n\nAfter\n'
	],
	[
		'quoted note, q callout+e',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		'> :::note\n> X\n> :::\n',
		'> :::note\n> a\n>\n> > :::note\n> > X\n> > :::\n>\n> b\n> :::\n\nAfter\n',
		'> :::note\n> a\n>\n> > :::note\n> > X\n> > :::\n>\n> Z\n>\n> b\n> :::\n\nAfter\n'
	],
	[
		'item note, i callout+e',
		'- :::note\n  a‸b\n  :::\n- after\n',
		'- :::note\n  X\n  :::\n',
		'- :::note\n  a\n\n  - :::note\n    X\n    :::\n\n  b\n  :::\n- after\n',
		'- :::note\n  a\n\n  - :::note\n    X\n    :::\n\n  Z\n\n  b\n  :::\n- after\n'
	],
	[
		'note mid, q fence+e',
		':::note\na‸b\n:::\n',
		'> ```\n> c\n> ```\n',
		':::note\na\n\n> ```\n> c\n> ```\n\nb\n:::\n',
		':::note\na\n\n> ```\n> c\n> ```\n\nZ\n\nb\n:::\n'
	],
	[
		'quote mid, l fence+e',
		'> a‸b\n>\n> rest\n',
		'- x\n  ```\n  c\n  ```\n',
		'> a\n>\n> - x\n>   ```\n>   c\n>   ```\n>\n> b\n>\n> rest\n',
		'> a\n>\n> - x\n>   ```\n>   c\n>   ```\n>\n> Z\n>\n> b\n>\n> rest\n'
	],
	[
		'item mid, lfence',
		'- a‸b\n- after\n',
		'- x\n  ```\n  c\n  ```',
		'- ax\n  ```\n  c\n  ```\n  b\n- after\n',
		'- ax\n  ```\n  cZ\n  ```\n  b\n- after\n'
	],
	// A seed found it: a last line of markers alone is a blank line, which takes the text.
	[
		'quote mid, code then a bare quote line',
		'> a‸b\n',
		'> x\n>\n>     co\n> ',
		'> ax\n>\n>     co\n> b\n',
		'> ax\n>\n>     co\n> Zb\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, after, typed] of ROWS)
		it(`${mode}: ${name}`, async () => {
			expect(await pasted(marked, mode, clip)).toEqual([after, typed]);
		});

const QUOTED: [name: string, quote: string][] = [
	['a fence', '> x\n> ```\n> c\n> ```'],
	['a table', '> x\n>\n> | t |\n> | - |'],
	['a callout', '> x\n>\n> :::note\n> X\n> :::']
];
const HOSTS: [name: string, marked: string][] = [
	['mid-text', '> a‸b\n>\n> rest\n'],
	['its text start', '> ‸ab\n>\n> rest\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [kind, quote] of QUOTED)
		for (const [where, marked] of HOSTS)
			for (const ending of ['', '\n'])
				it(`${mode}: a quote ending on ${kind}, taken in at ${where}${ending ? ' with its ending' : ''}, lands as its text`, async () => {
					const text = quote.replace(/^> ?/gm, '');
					expect(await pasted(marked, mode, quote + ending)).toEqual(
						await pasted(marked, mode, text + ending)
					);
				});
