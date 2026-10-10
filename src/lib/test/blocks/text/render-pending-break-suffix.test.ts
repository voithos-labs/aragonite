// @vitest-environment jsdom
// Shift+Enter at a block's end draws the line it opens, in every mode, from the editor's own record
// of it: caret anchors after the text, which add no text to the DOM read.
// Miss-analysis: no render test drew a pending break in a block with bytes past its text, and the
// line was read from a trailing backslash, so source mode never drew one.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { hiddenSuffixLength, rawTextOfContent } from '#lib/caret/widget-offset.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** The block's top-level children in order: text, the suffix span, or a break anchor. */
function shape(el: HTMLElement): string[] {
	return [...el.childNodes].map((node) => {
		if (node instanceof HTMLBRElement) return `<br ${node.dataset.caretAnchor ?? ''}>`;
		if (node instanceof HTMLElement && node.hasAttribute('data-block-suffix')) {
			return `suffix:${node.textContent}`;
		}
		return node.textContent ?? '';
	});
}

async function openBreakAt(source: string, at: number, mode: 'source' | 'live') {
	const editor = mountEditor({ source, presentationMode: mode });
	await pressKeyAt(editor, [0], at, { key: 'Enter', shiftKey: true });
	return { editor, el: surfaceAt(editor, [0]) };
}

describe.each(['source', 'live'] as const)('%s mode: the line a pending break opens', (mode) => {
	it('follows the text with two anchors', async () => {
		const { el } = await openBreakAt('abc\n', 3, mode);

		expect(shape(el)).toEqual(['abc', '<br break>', '<br break>']);
	});

	it('draws a heading’s closing run before the new line', async () => {
		const { el } = await openBreakAt('# Hi #\n', 6, mode);

		expect(shape(el).slice(1)).toEqual(['Hi', 'suffix: #', '<br break>', '<br break>']);
	});

	it('draws a setext underline after the new line, on a line of its own', async () => {
		const { el } = await openBreakAt('Hi\n===\n', 2, mode);

		expect(shape(el)).toEqual(['Hi', '<br break>', '<br break>', 'suffix:\n===']);
	});

	it('reads back from the DOM as the stored bytes', async () => {
		const { editor, el } = await openBreakAt('# Hi #\n', 6, mode);

		expect(rawTextOfContent(el, editor.source(), ' #')).toBe('# Hi #');
	});
});

describe('live mode: a pending break after a hidden closing run', () => {
	it('still reads the run’s length with the line after it', async () => {
		const { el } = await openBreakAt('# Hi #\n', 6, 'live');

		expect(hiddenSuffixLength(el)).toBe(2);
	});
});
