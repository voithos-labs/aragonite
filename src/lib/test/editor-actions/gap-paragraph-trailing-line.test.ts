// @vitest-environment jsdom
// A letter or Enter at the gap past a container's last block opens its paragraph on the blank line
// the body ends with (the line a pasted ending opened, or an open quote's bare `>`), as at the
// document's end, so no blank container line is left under it.
// Miss-analysis: the separator rule read only the document's trailing lines, every gap row typed at
// a container's end with no blank line under its last block, and no paste left one there before.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { mountCase, pasteGesture, placeRange, type Editor } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const MODES: PresentationMode[] = ['source', 'live'];

/** Presses `key`, then reads the bytes; no dev check fires and the tree reads as its bytes. */
async function press(editor: Editor, key: string): Promise<string> {
	await pressHardwareKey(document.activeElement as HTMLElement, { key });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const { getDocument, getGrammar } = editor.instance.__test;
	expect(describeConvergence(getDocument(), getGrammar())).toBeNull();
	return editor.source();
}

describe('a key at the gap past a container’s last block', () => {
	// [name, source, the gap's parent, the gap's byte, after a letter, after Enter]
	const ROWS: [string, string, number[], number, string, string][] = [
		[
			'a quote over its blank last line',
			'> alpha\n>\n> ***\n>\n\nAfter\n',
			[0],
			16,
			'> alpha\n>\n> ***\n>\n> Z\n\nAfter\n',
			'> alpha\n>\n> ***\n>\n>\n\nAfter\n'
		],
		[
			'an open quote over its bare `>`',
			'> alpha\n>\n> ***\n>',
			[0],
			16,
			'> alpha\n>\n> ***\n>\n> Z',
			'> alpha\n>\n> ***\n>\n>\n'
		],
		[
			'an open quote that ends on its last block, which has no line to give',
			'> alpha\n>\n> ***',
			[0],
			16,
			'> alpha\n>\n> ***\n>\n> Z',
			'> alpha\n>\n> ***\n>\n>\n'
		],
		[
			'an open CRLF quote over its bare `>`',
			'> alpha\r\n>\r\n> ***\r\n>',
			[0],
			19,
			'> alpha\r\n>\r\n> ***\r\n>\r\n> Z',
			'> alpha\r\n>\r\n> ***\r\n>\r\n>\r\n'
		],
		[
			'a quote ending a callout, the closing line right under it',
			':::note\n> alpha\n>\n> ***\n>\n:::\n',
			[0, 1],
			24,
			':::note\n> alpha\n>\n> ***\n>\n> Z\n:::\n',
			':::note\n> alpha\n>\n> ***\n>\n>\n:::\n'
		],
		[
			'a quote in a quote, the outer one’s text right under it',
			'> > alpha\n> >\n> > ***\n> >\n> tail\n',
			[0, 0],
			22,
			'> > alpha\n> >\n> > ***\n> >\n> > Z\n> >\n> tail\n',
			'> > alpha\n> >\n> > ***\n> >\n> >\n> tail\n'
		],
		[
			'a CRLF quote over its blank last line',
			'> alpha\r\n>\r\n> ***\r\n>\r\n\r\nAfter\r\n',
			[0],
			19,
			'> alpha\r\n>\r\n> ***\r\n>\r\n> Z\r\n\r\nAfter\r\n',
			'> alpha\r\n>\r\n> ***\r\n>\r\n>\r\n\r\nAfter\r\n'
		],
		[
			'a quote in an item',
			'- > alpha\n  >\n  > ***\n  >\n\nAfter\n',
			[0, 0, 0],
			22,
			'- > alpha\n  >\n  > ***\n  >\n  > Z\n\nAfter\n',
			'- > alpha\n  >\n  > ***\n  >\n  >\n\nAfter\n'
		],
		[
			'a callout over a blank line above its closer',
			':::note\nalpha\n\n***\n\n:::\n',
			[0],
			20,
			':::note\nalpha\n\n***\n\nZ\n:::\n',
			':::note\nalpha\n\n***\n\n\n\n:::\n'
		],
		[
			'a details body over the blank line above its closing line',
			'<details open>\n<summary>s</summary>\n\nalpha\n\n***\n\n</details>\n',
			[0],
			46,
			'<details open>\n<summary>s</summary>\n\nalpha\n\n***\n\nZ\n</details>\n',
			'<details open>\n<summary>s</summary>\n\nalpha\n\n***\n\n\n\n</details>\n'
		],
		[
			'a quote whose blank last line alone parts it from the paragraph under it',
			'> alpha\n>\n> ***\n>\nAfter\n',
			[0],
			16,
			'> alpha\n>\n> ***\n>\n> Z\n>\nAfter\n',
			'> alpha\n>\n> ***\n>\n>\nAfter\n'
		],
		[
			'a quote in an item, the paragraph right under the list',
			'- > alpha\n  >\n  > ***\n  >\nAfter\n',
			[0, 0, 0],
			22,
			'- > alpha\n  >\n  > ***\n  >\n  > Z\n  >\nAfter\n',
			'- > alpha\n  >\n  > ***\n  >\n  >\nAfter\n'
		],
		[
			'a callout closing an open file, whose last line is its closer',
			':::note\nalpha\n\n***\n:::',
			[0],
			19,
			':::note\nalpha\n\n***\n\nZ\n:::',
			':::note\nalpha\n\n***\n\n\n\n:::'
		],
		[
			'the document, its sibling route',
			'alpha\n\n***\n\n',
			[],
			11,
			'alpha\n\n***\n\nZ\n',
			'alpha\n\n***\n\n\n'
		]
	];
	for (const mode of MODES)
		for (const [name, source, parent, at, letter, enter] of ROWS)
			for (const [key, after] of [
				['Z', letter],
				['Enter', enter]
			])
				it(`${mode}: ${name}, ${key}`, async () => {
					const editor = mountCase(source, mode);
					await editor.settle();
					// A splice of the same bytes puts the caret on the boundary, as a paste's landing does.
					const op = { kind: 'insertBlock' } as const;
					await editor.instance.__test.spliceSource(source, { at, holds: 'boundary', parent }, op);
					await editor.settle();
					expect(editor.instance.__test.getGapCaret()).toMatchObject({ parentPath: parent });
					expect(await press(editor, key)).toBe(after);
				});
});

/** Each container around `alpha‸`: its lines, the prefix its body lines take, its blank line. */
const WRAPS: Record<string, { lines: string[]; prefix: string; blank: string; open: boolean }> = {
	'a quote': { lines: ['> alpha‸'], prefix: '> ', blank: '>', open: true },
	'an alert': { lines: ['> [!NOTE]', '> alpha‸'], prefix: '> ', blank: '>', open: true },
	'a quote in an item': { lines: ['- > alpha‸'], prefix: '  > ', blank: '  >', open: true },
	'a callout': { lines: [':::note', 'alpha‸', ':::'], prefix: '', blank: '', open: false },
	'a details body': {
		lines: ['<details open>', '<summary>s</summary>', '', 'alpha‸', '', '</details>'],
		prefix: '',
		blank: '',
		open: false
	}
};
const BLOCKS: Record<string, string[]> = {
	'a fence': ['```', 'q', '```'],
	'a table': ['| a |', '|---|', '| 1 |'],
	'a footnote': ['[^9]: note'],
	'a rule': ['***']
};

describe('a letter after a block pasted with its line ending at a container’s end', () => {
	for (const mode of MODES)
		for (const eol of ['\n', '\r\n'])
			for (const [wrap, w] of Object.entries(WRAPS))
				// An open end in CRLF only where the container's own lines hold one.
				for (const tail of w.open && (eol === '\n' || w.lines.length > 1)
					? [`${eol}${eol}After${eol}`, '']
					: [`${eol}${eol}After${eol}`])
					for (const [block, lines] of Object.entries(BLOCKS))
						it(`${mode}, ${JSON.stringify(eol)}: ${block} in ${wrap}${tail ? '' : ' at an open end'}`, async () => {
							const marked = w.lines.join(eol) + tail;
							const editor = mountCase(marked.replace('‸', ''), mode);
							await editor.settle();
							const at = pointAtByte(
								measured(editor.instance.__test.getDocument()),
								marked.indexOf('‸')
							)!;
							expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
							await pasteGesture(editor, { 'text/plain': lines.join(eol) + eol }, 'key');
							const after = editor.source();
							// The ending's line stands under the block; the letter's paragraph takes it.
							const under = `${w.prefix}${lines.at(-1)}${eol}${w.blank}`;
							const end = after.lastIndexOf(under) + under.length;
							expect(end).toBeGreaterThan(under.length);
							const typed = `${after.slice(0, end)}${eol}${w.prefix}Z${after.slice(end)}`;
							expect(await press(editor, 'Z')).toBe(typed);
						});
});

// The two writes to the container's own fields, its blank last line and its bare `>`, undo with
// the letter. Miss-analysis: no row undid a letter typed at a container's end gap.
describe('one Ctrl+Z after the letter gives the line back', () => {
	it.each([
		['a quote over its blank last line', '> alpha\n>\n> ***\n>\n\nAfter\n', 16],
		['an open quote over its bare `>`', '> alpha\n>\n> ***\n>', 16],
		['an open CRLF quote over its bare `>`', '> alpha\r\n>\r\n> ***\r\n>', 19],
		[
			'a details body over the blank line above its closing line',
			'<details open>\n<summary>s</summary>\n\nalpha\n\n***\n\n</details>\n',
			46
		]
	])('%s', async (_, source, at) => {
		const editor = mountCase(source, 'source');
		await editor.settle();
		const op = { kind: 'insertBlock' } as const;
		await editor.instance.__test.spliceSource(source, { at, holds: 'boundary', parent: [0] }, op);
		await editor.settle();
		expect(await press(editor, 'Z')).not.toBe(source);
		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(source);
	});
});

// A letter typed at a rule focused whole opens its paragraph through the same write.
// Miss-analysis: the gap rows reached the write by the gap caret alone.
describe('a letter at a rule focused whole, the last block of its container', () => {
	it.each([
		[
			'a quote over its blank last line',
			'> alpha\n>\n> ***\n>\n\nAfter\n',
			[0, 1],
			'> alpha\n>\n> ***\n>\n> Z\n\nAfter\n'
		],
		[
			'an open quote over its bare `>`',
			'> alpha\n>\n> ***\n>',
			[0, 1],
			'> alpha\n>\n> ***\n>\n> Z'
		],
		[
			'a callout over a blank line above its closer',
			':::note\nalpha\n\n***\n\n:::\n',
			[0, 2],
			':::note\nalpha\n\n***\n\nZ\n:::\n'
		]
	])('%s', async (_, source, rule, after) => {
		const editor = mountCase(source, 'source');
		await editor.settle();
		editor.instance.__test.getBlockComponent(rule)!.focus(0);
		await editor.settle();
		expect(await press(editor, 'Z')).toBe(after);
		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(source);
	});
});
