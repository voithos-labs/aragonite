// @vitest-environment jsdom
// Text pasted into a fenced block's body goes through the block's own write wherever the line it
// leaves could close the fence, or it lands on the closing line: the fence grows past a body line
// that would close it, and the closing line stays one, as when the same text is typed there. Every
// fence kind the grammar opens, LF and CRLF, at the top level, in an item and in a quote.
// Miss-analysis: the fence rows asked whether a pasted line closes the fence alone, so no row joined
// a pasted run to the backticks already on the line, or pasted on the closing line.
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

/** `clip` pasted by the key at `‸`, then `Z` typed: the bytes. */
async function typedAfter(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const point = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return editor.source();
}

const BOTH: PresentationMode[] = ['source', 'live'];
// The closing line is text in source mode alone; live mode hides it.
const SOURCE: PresentationMode[] = ['source'];

// [name, modes, marked, clipboard, the bytes once `Z` is typed]
const ROWS: [string, PresentationMode[], string, string, string][] = [
	['backticks joined to a body run', BOTH, '```\n‸`\n```\n', '``', '````\n``Z`\n````\n'],
	['tildes joined to a body run', BOTH, '~~~\n‸~\n~~~\n', '~~', '~~~~\n~~Z~\n~~~~\n'],
	['a four-backtick fence', BOTH, '````\n‸``\n````\n', '``', '`````\n``Z``\n`````\n'],
	['in CRLF', BOTH, '```\r\n‸`\r\n```\r\n', '``', '````\r\n``Z`\r\n````\r\n'],
	['in an item', BOTH, '- ```\n  ‸`\n  ```\n', '``', '- ````\n  ``Z`\n  ````\n'],
	['in a quote', BOTH, '> ```\n> ‸`\n> ```\n', '``', '> ````\n> ``Z`\n> ````\n'],
	['a pasted line that closes', BOTH, '```\nab‸\n```\n', 'x\n```\ny', '````\nabx\n```\nyZ\n````\n'],
	[
		'at the closing line’s start',
		SOURCE,
		'```js\ncode\n‸```\n\nAfter\n',
		'z',
		'```js\ncode\nzZ\n```\n\nAfter\n'
	],
	[
		'at the closing line’s start, with a line ending',
		SOURCE,
		'```js\ncode\n‸```\n\nAfter\n',
		'z\n',
		'```js\ncode\nz\nZ\n```\n\nAfter\n'
	],
	[
		'inside the closing run',
		SOURCE,
		'```js\ncode\n`‸``\n\nAfter\n',
		'z',
		'```js\ncode\n`zZ``\n```\n\nAfter\n'
	],
	[
		'at the closing line’s end',
		SOURCE,
		'```js\ncode\n```‸\n\nAfter\n',
		'z',
		'```js\ncode\n```zZ\n```\n\nAfter\n'
	],
	['a tilde closer', SOURCE, '~~~\ncode\n‸~~~\n\nAfter\n', 'z', '~~~\ncode\nzZ\n~~~\n\nAfter\n'],
	[
		'a CRLF closer',
		SOURCE,
		'```js\r\ncode\r\n‸```\r\n\r\nAfter\r\n',
		'z',
		'```js\r\ncode\r\nzZ\r\n```\r\n\r\nAfter\r\n'
	],
	[
		'a closer in an item',
		SOURCE,
		'- ```js\n  code\n  ‸```\n- after\n',
		'z',
		'- ```js\n  code\n  zZ\n  ```\n- after\n'
	],
	[
		'a closer in a quote',
		SOURCE,
		'> ```js\n> code\n> ‸```\n\nAfter\n',
		'z',
		'> ```js\n> code\n> zZ\n> ```\n\nAfter\n'
	]
];

for (const [name, modes, marked, clip, typed] of ROWS)
	for (const mode of modes)
		it(`${name}, ${mode}`, async () => {
			expect(await typedAfter(marked, mode, clip)).toBe(typed);
		});
