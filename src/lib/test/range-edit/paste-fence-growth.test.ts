// @vitest-environment jsdom
// A paste that puts a closing line in a `:::` container's body grows the fence around it, as the
// kind's own write does when that line is typed: by the key and by `insertMarkdown`, at a caret and
// over a range, at any depth, an inner fence first. Where a pasted container ends on its closing
// line, its last line ending leaves one empty line under it, as after a pasted fence.
// Miss-analysis: the fence rows pasted at one place by one route, and none asked whether an answer
// written as bytes, which no container rebuild sees, grows the fence.
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
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, type PasteRoute } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted by `route` at `‸` or over `⟦ ⟧`: the bytes, then the bytes once `Z` is typed. */
async function pasted(marked: string, mode: PresentationMode, clip: string, route: PasteRoute) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, route);
	const left = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(
		describeConvergence(editor.instance.__test.getDocument(), editor.instance.__test.getGrammar())
	).toBeNull();
	return [left, editor.source()];
}

const NESTED = ':::warn\nw\n:::\n';

// [name, marked, clipboard, the bytes after, the bytes once `Z` is typed]
const ROWS: [string, string, string, string, string][] = [
	[
		'at a body’s end',
		':::note Hi\nx‸\n:::\n',
		NESTED,
		'::::note Hi\nx\n\n:::warn\nw\n:::\n\n::::\n',
		'::::note Hi\nx\n\n:::warn\nw\n:::\n\nZ\n::::\n'
	],
	[
		'with no line ending, the caret in its body',
		':::note Hi\nx‸\n:::\n',
		':::warn\nw\n:::',
		'::::note Hi\nx\n\n:::warn\nw\n:::\n::::\n',
		'::::note Hi\nx\n\n:::warn\nwZ\n:::\n::::\n'
	],
	[
		'at a body’s start',
		':::note Hi\n‸x\n:::\n',
		NESTED,
		'::::note Hi\n:::warn\nw\n:::\n\nx\n::::\n',
		'::::note Hi\n:::warn\nw\n:::\n\nZ\n\nx\n::::\n'
	],
	[
		'a four-colon fence pasted grows the fence to five',
		':::note Hi\nx‸\n:::\n',
		'::::warn\nw\n::::\n',
		':::::note Hi\nx\n\n::::warn\nw\n::::\n\n:::::\n',
		':::::note Hi\nx\n\n::::warn\nw\n::::\n\nZ\n:::::\n'
	],
	[
		'a fence long enough already stays',
		'::::note Hi\nx‸\n::::\n',
		NESTED,
		'::::note Hi\nx\n\n:::warn\nw\n:::\n\n::::\n',
		'::::note Hi\nx\n\n:::warn\nw\n:::\n\nZ\n::::\n'
	],
	[
		'two deep, the inner fence first',
		'::::note Hi\n:::tip\nx‸\n:::\n::::\n',
		NESTED,
		':::::note Hi\n::::tip\nx\n\n:::warn\nw\n:::\n\n::::\n:::::\n',
		':::::note Hi\n::::tip\nx\n\n:::warn\nw\n:::\n\nZ\n::::\n:::::\n'
	],
	[
		'in a quote',
		'> :::note Hi\n> x‸\n> :::\n',
		NESTED,
		'> ::::note Hi\n> x\n>\n> :::warn\n> w\n> :::\n>\n> ::::\n',
		'> ::::note Hi\n> x\n>\n> :::warn\n> w\n> :::\n>\n> Z\n> ::::\n'
	],
	[
		'in a list item',
		'- :::note Hi\n  x‸\n  :::\n',
		NESTED,
		'- ::::note Hi\n  x\n\n  :::warn\n  w\n  :::\n\n  ::::\n',
		'- ::::note Hi\n  x\n\n  :::warn\n  w\n  :::\n\n  Z\n  ::::\n'
	],
	[
		'a generic container',
		':::box\nx‸\n:::\n',
		':::tip\nt\n:::\n',
		'::::box\nx\n\n:::tip\nt\n:::\n\n::::\n',
		'::::box\nx\n\n:::tip\nt\n:::\n\nZ\n::::\n'
	],
	[
		'a closing line pasted over a body line’s text',
		':::note Hi\nx\n\n⟦y⟧\n:::\n',
		':::',
		'::::note Hi\nx\n\n:::\n::::\n',
		'::::note Hi\nx\n\n:::Z\n::::\n'
	]
];

// A `:::` line with no closing line opens no container: one pasted in its text closes it there and
// no fence grows. Miss-analysis: every fence row pasted into a closed container.
ROWS.push(
	[
		'in an open callout',
		':::note\nbo‸dy\n',
		'x\n:::\ny',
		':::note\nbox\n:::\nydy\n',
		':::note\nbox\n:::\nyZdy\n'
	],
	[
		'in an open callout ending the file',
		':::note\nbo‸dy',
		'x\n:::\ny',
		':::note\nbox\n:::\nydy',
		':::note\nbox\n:::\nyZdy'
	],
	[
		'in an open callout in a quote',
		'> :::note\n> bo‸dy\n',
		'x\n:::\ny',
		'> :::note\n> box\n> :::\n> ydy\n',
		'> :::note\n> box\n> :::\n> yZdy\n'
	]
);

for (const [name, marked, clip, left, typed] of ROWS)
	for (const route of ['key', 'insertMarkdown'] as PasteRoute[])
		for (const mode of ['source', 'live'] as PresentationMode[])
			it(`${name}, ${route}, ${mode}`, async () => {
				expect(await pasted(marked, mode, clip, route)).toEqual([left, typed]);
			});
