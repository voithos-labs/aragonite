// @vitest-environment jsdom
// `insertMarkdown` drops one final line ending of its payload: a snippet's terminator, not a copied
// line break. So a block inserted from a menu, the slash commands or a toolbar leaves the caret at
// the last place it takes in what was inserted, and a letter typed next goes there, as in 0.11.5.
// A second ending is content, and a clipboard paste keeps its last line ending by every route.
// Miss-analysis: the endings rows pasted clipboards, and no row typed a letter after a block the
// API inserted, so no row asked where a snippet's own terminator leaves the caret.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InsertMarkdownOptions } from '#lib/editor-props.js';
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

const FENCE = '```\n\n```\n';
const TABLE = '| Column | Column |\n| --- | --- |\n|  |  |\n';
const CALLOUT = ':::note\n\n:::\n';
const DETAILS = '<details>\n<summary></summary>\n\n</details>\n';

/** The editor over `marked`, its caret at the `‸`. */
async function caretAt(marked: string, mode: PresentationMode = 'source'): Promise<Editor> {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	return editor;
}

/** The source once `Z` is typed where the caret was left. */
async function typed(editor: Editor): Promise<string> {
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	return editor.source();
}

async function insertedThenTyped(marked: string, md: string, options?: InsertMarkdownOptions) {
	const editor = await caretAt(marked);
	expect(await editor.instance.insertMarkdown(md, options)).toBe(true);
	await editor.settle();
	return typed(editor);
}

// Each block payload, on an empty line at the caret (a slash pick there) and below a line with text
// (the catalogue's rows, a slash pick after text); the letter lands where `next` landed it.
const BLOCKS: [name: string, md: string, empty: string, below: string][] = [
	['a code fence', FENCE, '```\nZ\n```\n', 'abc\n\n```\nZ\n```\n'],
	[
		'a table',
		TABLE,
		'| Column | Column |\n| --- | --- |\n|  | Z |\n',
		'abc\n\n| Column | Column |\n| --- | --- |\n|  | Z |\n'
	],
	['a callout', CALLOUT, ':::note\n\nZ\n:::\n', 'abc\n\n:::note\n\nZ\n:::\n'],
	[
		'a details block',
		DETAILS,
		'<details>\n<summary>Z</summary>\n\n</details>\n',
		'abc\n\n<details>\n<summary>Z</summary>\n\n</details>\n'
	],
	['a rule', '---\n', '---\n\nZ\n', 'abc\n\n---\n\nZ\n'],
	['a bullet', '- ', '- Z\n', 'abc\n\n- Z\n'],
	['a numbered item', '1. ', '1. Z\n', 'abc\n\n1. Z\n'],
	['a to-do', '- [ ] ', '- [ ] Z\n', 'abc\n\n- [ ] Z\n'],
	['a quote', '> ', '> Z\n', 'abc\n\n> Z\n']
];

describe('insertMarkdown: a snippet’s last line ending is its terminator', () => {
	for (const [name, md, empty, below] of BLOCKS) {
		it(`${name} on an empty line takes the letter typed next`, async () => {
			expect(await insertedThenTyped('‸\n', md)).toBe(empty);
		});
		it(`${name} below a line with text takes the letter typed next`, async () => {
			expect(await insertedThenTyped('abc‸\n', md, { placement: 'below' })).toBe(below);
		});
	}

	it('a $$ block leaves the caret at its body’s end', async () => {
		const editor = await caretAt('‸\n');
		expect(await editor.instance.insertMarkdown('$$\n\n$$\n')).toBe(true);
		await editor.settle();
		expect(editor.instance.getSelection()?.focus).toEqual({ path: [0], offset: 3 });
	});

	it('a table at a paragraph’s end takes the next letter in its last cell', async () => {
		expect(await insertedThenTyped('abc‸\n', TABLE)).toBe(
			'abc\n\n| Column | Column |\n| --- | --- |\n|  | Z |\n'
		);
	});

	it('a CRLF terminator is one line ending too', async () => {
		expect(await insertedThenTyped('‸\n', FENCE.replaceAll('\n', '\r\n'))).toBe('```\nZ\n```\n');
	});

	it('a second line ending is content, as a paste of the payload without it', async () => {
		expect(await insertedThenTyped('‸\n', `${FENCE}\n`)).toBe('```\n\n```\n\nZ\n');
	});

	it('a payload that is only a line ending inserts nothing', async () => {
		const editor = await caretAt('abc‸\n');
		expect(await editor.instance.insertMarkdown('\n')).toBe(false);
		expect(editor.source()).toBe('abc\n');
	});

	it('a draft’s insert drops it as `insertMarkdown` does', async () => {
		const editor = await caretAt('‸\n');
		expect(await editor.instance.edit().insert(FENCE).commit()).toEqual({ ok: true });
		await editor.settle();
		expect(await typed(editor)).toBe('```\nZ\n```\n');
	});

	it('a clipboard paste of the same bytes keeps its last line ending', async () => {
		const editor = await caretAt('‸\n');
		await pasteGesture(editor, { 'text/plain': FENCE }, 'key');
		await editor.settle();
		expect(await typed(editor)).toBe('```\n\n```\n\nZ\n');
	});
});
