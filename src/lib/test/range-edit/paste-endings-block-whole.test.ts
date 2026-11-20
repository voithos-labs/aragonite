// @vitest-environment jsdom
// Line endings alone pasted over a block held whole (a fence, a heading's line, a rule, a table)
// answer as they do over a paragraph in its place: the block's line is left blank, the blank line
// under it stands for the first ending, and the caret is on that line.
// Miss-analysis: the whole-block rows pasted text or spaces and the ending rows pasted at a caret,
// so no row pasted an ending over a block held whole, where one blank line too many was left.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
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
import { checkHost } from './test-host';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted by the key over `⟦ ⟧` in source mode, then `Z` typed: the bytes after each. */
async function pastedThenTyped(marked: string, clip: string) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), 'source');
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	const pasted = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
	return { pasted, typed: editor.source() };
}

const inContainer = (block: string, marks: string) => block.replace(/\n/g, `\n${marks}`);

// [name, the document around a block, held whole]
const HOSTS: [string, (block: string) => string][] = [
	['between paragraphs', (b) => `alpha\n\n⟦${b}⟧\n\nAfter\n`],
	['first in the document', (b) => `⟦${b}⟧\n\nAfter\n`],
	['over two blank lines', (b) => `alpha\n\n⟦${b}⟧\n\n\nAfter\n`],
	['in a quote', (b) => `> alpha\n>\n> ⟦${inContainer(b, '> ')}⟧\n>\n> After\n`],
	// Miss-analysis: every quote host had a paragraph under the block, so none left the block's
	// blank line as the quote's last, where an empty line's ending added a second line.
	['on a quote’s last line', (b) => `> alpha\n>\n> ⟦${inContainer(b, '> ')}⟧\n`],
	['second in an item', (b) => `- a\n\n  ⟦${inContainer(b, '  ')}⟧\n\n  more\n- b\n`],
	['right under an alert’s line', (b) => `> [!NOTE]\n> ⟦${inContainer(b, '> ')}⟧\n>\n> text\n`],
	['right under a title row', (b) => `:::note Title\n⟦${b}⟧\n\ntext\n:::\n`],
	['in a crlf file', (b) => `alpha\n\n⟦${b}⟧\n\nAfter\n`.replace(/\n/g, '\r\n')]
];

const BLOCKS: [string, string][] = [
	['a fence', '```\ncode\n```'],
	['a heading’s line', '# head'],
	['a setext heading', 'Title\n==='],
	['an html block', '<div>\nx\n</div>']
];

const CLIPS: [string, string][] = [
	['one ending', '\n'],
	['two endings', '\n\n'],
	['a space and an ending', ' \n']
];

describe('line endings over a block held whole, as over a paragraph in its place', () => {
	for (const [hostName, host] of HOSTS)
		for (const [clipName, clip] of CLIPS)
			for (const [blockName, block] of BLOCKS)
				it(`${blockName} ${hostName}, ${clipName}`, async () => {
					const twin = await pastedThenTyped(host('beta'), clip);
					expect(await pastedThenTyped(host(block), clip)).toEqual(twin);
				});
});

// [name, marked, clipboard, the bytes after the paste, the bytes once `Z` is typed]
const SPELLED: [string, string, string, string, string][] = [
	[
		'a fence between paragraphs',
		'alpha\n\n⟦```\ncode\n```⟧\n\nAfter\n',
		'\n',
		'alpha\n\n\n\nAfter\n',
		'alpha\n\n\nZ\n\nAfter\n'
	],
	[
		'a paragraph between paragraphs, the twin',
		'alpha\n\n⟦beta⟧\n\nAfter\n',
		'\n',
		'alpha\n\n\n\nAfter\n',
		'alpha\n\n\nZ\n\nAfter\n'
	],
	[
		'a heading’s line in a quote',
		'> alpha\n>\n> ⟦# head⟧\n>\n> After\n',
		'\n',
		'> alpha\n>\n> \n>\n> After\n',
		'> alpha\n>\n> \n> Z\n>\n> After\n'
	],
	[
		'a fence right under an alert’s line: the blank line moves above',
		'> [!NOTE]\n> ⟦```\n> code\n> ```⟧\n>\n> text\n',
		'\n',
		'> [!NOTE]\n>\n> \n>\n> text\n',
		'> [!NOTE]\n>\n> \n> Z\n>\n> text\n'
	],
	[
		'two endings stack no second line',
		'alpha\n\n⟦```\ncode\n```⟧\n\nAfter\n',
		'\n\n',
		'alpha\n\n\n\nAfter\n',
		'alpha\n\n\nZ\n\nAfter\n'
	],
	[
		'text with its ending keeps the blank line under the block',
		'alpha\n\n⟦```\ncode\n```⟧\n\nAfter\n',
		'x\n',
		'alpha\n\nx\n\n\nAfter\n',
		'alpha\n\nx\n\nZ\n\nAfter\n'
	]
];

describe('line endings over a block held whole, spelled', () => {
	for (const [name, marked, clip, pasted, typed] of SPELLED)
		it(name, async () => {
			expect(await pastedThenTyped(marked, clip)).toEqual({ pasted, typed });
		});
});

// A rule and a table take no text range in a mounted editor, so the core answers for them.
const UNMOUNTED: [string, string][] = [
	['a rule', '***'],
	['a table', '| a |\n| - |\n| b |']
];

describe('line endings over a block the core alone is handed whole', () => {
	const answer = (marked: string, clip: string, mode: Mode) => {
		const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
		const gesture = { paste: clip, plain: false, holds: 'text' } as const;
		const { source, caret } = editRange(
			marked.replace(/[⟦⟧]/g, ''),
			{ from, to },
			gesture,
			mode,
			checkHost()
		);
		return { source, at: caret.at };
	};
	for (const mode of ['source', 'live'] as const)
		for (const [hostName, host] of HOSTS)
			for (const [clipName, clip] of CLIPS)
				for (const [blockName, block] of UNMOUNTED)
					it(`${blockName} ${hostName}, ${clipName}, ${mode}`, () => {
						expect(answer(host(block), clip, mode)).toEqual(answer(host('beta'), clip, mode));
					});
});
