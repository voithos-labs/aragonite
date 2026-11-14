// @vitest-environment jsdom
// A paste's blank lines, line endings and runs, mounted: blocks pasted on a blank line take it, a
// CRLF document keeps its ending, a title row takes blocks as one line, and live mode keeps the run
// a word was selected out of.
// Miss-analysis: these rows drove the dispatcher the core replaced, so deleting it deleted them,
// and no row of the core's own asked the same of the live path.
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

// [contract, source with `‸` for the caret or `⟦…⟧` for a range, clipboard, the bytes after]
const ROWS: [string, string, string, string][] = [
	[
		'blocks pasted on a blank line take it, a blank line on each side',
		'alpha\n\n‸\ndelta\n',
		'X\n\nY\n',
		'alpha\n\nX\n\nY\n\ndelta\n'
	],
	[
		'the same in a CRLF document, in its own ending',
		'alpha\r\n\r\n‸\r\ndelta\r\n',
		'X\n\nY\n',
		'alpha\r\n\r\nX\r\n\r\nY\r\n\r\ndelta\r\n'
	],
	[
		'text pasted on a blank line',
		'alpha\n\n‸\ndelta\n',
		'just text',
		'alpha\n\njust text\n\ndelta\n'
	],
	['a clipboard’s trailing blank line kept at the tail', 'x‸\n', '# h\n\n', 'x\n\n# h\n\n'],
	[
		'a title row takes blocks as one line',
		':::note Title‸\nBody\n:::\n',
		'one\n\ntwo\n',
		':::note Titleone two\nBody\n:::\n'
	],
	[
		'a list pasted in an empty item keeps the next item',
		'- ‸\n- keep\n',
		'- x\n- y',
		'- x\n- y\n- keep\n'
	],
	['a document of mixed endings writes its own', 'a\r\nb‸\r\n', 'x\ny', 'a\r\nbx\r\ny\r\n'],
	['a line ending mid-line splits the line', 'ab‸cd\n', 'x\n', 'abx\ncd\n'],
	['text over a whole bold word keeps the bold', 'Some **⟦bold⟧** x\n', 'X', 'Some **X** x\n']
];

for (const mode of ['source', 'live'] as PresentationMode[])
	for (const [name, marked, clip, after] of ROWS)
		it(`${mode}: ${name}`, async () => {
			const editor = mountCase(marked.replace(/[‸⟦⟧]/g, ''), mode);
			await editor.settle();
			const point = (at: number) =>
				pointAtByte(measured(editor.instance.__test.getDocument()), at)!;
			const [from, to] = marked.includes('⟦')
				? [marked.indexOf('⟦'), marked.indexOf('⟧') - 1]
				: [marked.indexOf('‸'), marked.indexOf('‸')];
			expect(await placeRange(editor, { anchor: point(from), focus: point(to) })).toBe(true);
			await pasteGesture(editor, { 'text/plain': clip }, 'key');
			expect(editor.source()).toBe(after);
			expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
			expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		});
