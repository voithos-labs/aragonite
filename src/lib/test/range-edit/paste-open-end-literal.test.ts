// @vitest-environment jsdom
// A line ending pasted on a file's open last line lands as on a last line that has one
// (`syntax-tree.md` § The last line), in literal text too: at an open fence's code end it is a new
// line of the code, which keeps its break as a blank last line does. After a fence's closing line,
// and after a heading whose last line is its underline, it is the line under the block.
// Miss-analysis: the open-end rows ended on a paragraph's text, so none landed the ending in code,
// past a closing line, or under an underline, where the last line written gained a break.
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

/** `clip` pasted at `‸` or over `⟦ ⟧`, then a letter: both bytes, no dev check, a fresh read. */
async function pasted(marked: string, mode: PresentationMode, clip: string) {
	const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.search(/[‸⟦]/);
	const to = marked.includes('⟧') ? marked.indexOf('⟧') - 1 : from;
	expect(
		await placeRange(editor, { anchor: pointAtByte(doc, from)!, focus: pointAtByte(doc, to)! })
	).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const after = editor.source();
	expect(
		describeConvergence(editor.instance.__test.getDocument(), editor.instance.__test.getGrammar())
	).toBeNull();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return [after, typed];
}

// [name, marked, clipboard, modes, the bytes after, the bytes after a letter]
const ROWS: [string, string, string, PresentationMode[], string, string][] = [
	[
		'an open fence’s code end',
		'alpha\n\n```\ncode‸',
		'\n',
		['source', 'live'],
		'alpha\n\n```\ncode\n\n',
		'alpha\n\n```\ncode\nZ\n'
	],
	[
		'text at an open fence’s code end',
		'alpha\n\n```\ncode‸',
		'x\n',
		['source', 'live'],
		'alpha\n\n```\ncodex\n\n',
		'alpha\n\n```\ncodex\nZ\n'
	],
	[
		'a closing line’s end',
		'alpha\n\n```\ncode\n```‸',
		'\n',
		['source'],
		'alpha\n\n```\ncode\n```\n\n\n',
		'alpha\n\n```\ncode\n```\n\nZ\n'
	],
	[
		'text at a closing line’s end',
		'alpha\n\n```\ncode\n```‸',
		'x\n',
		['source'],
		'alpha\n\n```\ncode\n```x\n\n```',
		'alpha\n\n```\ncode\n```x\nZ\n```'
	],
	[
		'a setext heading’s text',
		'alpha\n\n⟦Title\n===⟧',
		'x\n',
		['live'],
		'alpha\n\nx\n===\n\n\n',
		'alpha\n\nx\n===\n\nZ\n'
	],
	// A fence in an item: the new code line keeps the item's indent, which keeps it the code's.
	// Miss-analysis: every literal row stood at the top level, where a bare blank line is the code's.
	[
		'a fence in an item',
		'- ```\n  co‸',
		'\n',
		['source', 'live'],
		'- ```\n  co\n  \n',
		'- ```\n  co\n  Z\n'
	],
	[
		'text in a fence in an item',
		'- ```\n  co‸',
		'x\n',
		['source', 'live'],
		'- ```\n  cox\n  \n',
		'- ```\n  cox\n  Z\n'
	],
	// Code with no fence, and HTML, hold no blank last line: the ending leaves them, as Enter does.
	[
		'an indented code block',
		'alpha\n\n    code‸',
		'\n',
		['source', 'live'],
		'alpha\n\n    code\n\n\n',
		'alpha\n\n    code\n\nZ\n'
	],
	[
		'text in an indented code block',
		'alpha\n\n    code‸',
		'x\n',
		['source', 'live'],
		'alpha\n\n    codex\n\n\n',
		'alpha\n\n    codex\n\nZ\n'
	],
	['an HTML block', '<div>\nx‸', 'x\n', ['source'], '<div>\nxx\n\n\n', '<div>\nxx\n\nZ\n'],
	[
		'an indented code block in an item',
		'- a\n\n      code‸',
		'\n',
		['source', 'live'],
		'- a\n\n      code\n\n\n',
		'- a\n\n      code\n\nZ\n'
	],
	// The controls: mid-code, and a paragraph's open end.
	[
		'mid-code',
		'alpha\n\n```\nco‸de',
		'\n',
		['source'],
		'alpha\n\n```\nco\nde',
		'alpha\n\n```\nco\nZde'
	],
	['a paragraph', 'alpha\n\nbeta‸', '\n', ['source'], 'alpha\n\nbeta\n\n\n', 'alpha\n\nbeta\n\nZ\n']
];

for (const [name, marked, clip, modes, after, typed] of ROWS)
	for (const mode of modes)
		it(`${mode}: ${JSON.stringify(clip)} at ${name} on the open last line`, async () => {
			expect(await pasted(marked, mode, clip)).toEqual([after, typed]);
		});
