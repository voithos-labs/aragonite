// @vitest-environment jsdom
// `placement: 'below'` inserts a block of its own. On a paragraph with no text (an empty line, an
// empty item, an empty to-do) it goes in at the caret, where the paste's rules take it; anywhere
// else it opens a paragraph under the caret's top-level block. A letter typed after each row lands
// where the caret placement's does.
// Miss-analysis: every `below` row put the caret after text, so no row asked what it leaves on an
// empty line, where it left the line empty above the block.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { InsertMarkdownOptions } from '#lib/editor-props.js';
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
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, placeRange } from '../range-laws/gestures';

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

const PAYLOADS: [name: string, md: string][] = [
	['a rule', '---\n'],
	['a table', '| a |\n| - |\n'],
	['a fence', '```\n\n```\n'],
	['a bullet marker', '- ']
];

/** Whether `md` inserted at the caret `‸` changed anything, the bytes it left, then the bytes once
 *  `Z` is typed. */
async function inserted(
	marked: string,
	mode: PresentationMode,
	md: string,
	options?: InsertMarkdownOptions
): Promise<[boolean, string, string]> {
	const editor = mountCase(marked.replace('‸', ''), mode);
	await editor.settle();
	const at = pointAtByte(measured(editor.instance.__test.getDocument()), marked.indexOf('‸'))!;
	expect(await placeRange(editor, { anchor: at, focus: at })).toBe(true);
	const changed = await editor.instance.insertMarkdown(md, options);
	await editor.settle();
	const left = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	const typed = editor.source();
	await destroyMountedEditors();
	return [changed, left, typed];
}

const EMPTY: [name: string, marked: string][] = [
	['an empty line alone', '‸\n'],
	['an empty line between paragraphs', 'abc\n\n‸\n\ndef\n'],
	['an empty item', '- a\n- ‸\n- b\n'],
	['an empty nested item', '- a\n  - x\n  - ‸\n- b\n'],
	['an empty to-do', '- [ ] a\n- [ ] ‸\n- [ ] b\n'],
	['an empty line under a list', '- item\n\n‸\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [where, marked] of EMPTY)
		for (const [what, md] of PAYLOADS)
			it(`${mode}: ${what} below on ${where} goes in at the caret`, async () => {
				const below = await inserted(marked, mode, md, { placement: 'below' });
				expect(below).toEqual(await inserted(marked, mode, md));
			});

// A line with text keeps it: the block opens under the caret's top-level block.
const KEPT: [name: string, marked: string, md: string, changed: boolean, typed: string][] = [
	['after text', 'abc‸\n', '---\n', true, 'abc\n\n---\n\nZ\n'],
	['mid-text', 'ab‸c\n', '| a |\n| - |\n', true, 'abc\n\n| aZ |\n| - |\n'],
	['after an item’s text', '- a‸\n- b\n', '---\n', true, '- a\n- b\n\n---\n\nZ\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [where, marked, md, changed, typed] of KEPT)
		it(`${mode}: below ${where} keeps the caret’s line`, async () => {
			const [took, , got] = await inserted(marked, mode, md, { placement: 'below' });
			expect([took, got]).toEqual([changed, typed]);
		});
