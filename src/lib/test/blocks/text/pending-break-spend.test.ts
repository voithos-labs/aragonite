// @vitest-environment jsdom
// Shift+Enter at a block's end writes nothing; the next insertion writes the break ahead of itself,
// whichever route it takes, so the break and what follows it are one write.
// Miss-analysis: GH #522 and #614, every pending-break test typed a letter through the keydown
// route, so no case pressed a punctuation key, pasted, composed or pressed Shift+Enter twice.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MODES = ['source', 'live'] as const;

/** `abc` with the caret at its end and Shift+Enter pressed `times`. */
async function openBreak(
	mode: (typeof MODES)[number],
	times = 1,
	source = 'abc\n'
): Promise<{ editor: MountedEditor; el: HTMLElement }> {
	const editor = mountEditor({ source, presentationMode: mode });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, source.search(/\r?\n/));
	for (let i = 0; i < times; i++) await pressKey(el, { key: 'Enter', shiftKey: true });
	return { editor, el };
}

function paste(el: HTMLElement, text: string): void {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	el.dispatchEvent(e);
}

describe.each(MODES)('%s mode: the insertion after Shift+Enter at the end', (mode) => {
	it('writes nothing until something is inserted', async () => {
		const { editor } = await openBreak(mode);

		expect(editor.source()).toBe('abc\n');
	});

	it.each(['x', '-', '\\', '*'])('a typed %s starts the new line', async (key) => {
		const { editor, el } = await openBreak(mode);

		await pressKey(el, { key });

		expect(editor.source()).toBe(`abc\\\n${key}\n`);
	});

	it('a paste starts the new line', async () => {
		const { editor, el } = await openBreak(mode);

		paste(el, 'x');
		await editor.settle();

		expect(editor.source()).toBe('abc\\\nx\n');
	});

	it('a composed run starts the new line', async () => {
		const { editor, el } = await openBreak(mode);

		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.textContent = 'abcか';
		placeCaret(el, 4);
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'か' }));
		await editor.settle();

		expect(editor.source()).toBe('abc\\\nか\n');
	});

	it('text the browser inserts itself starts the new line', async () => {
		const { editor, el } = await openBreak(mode);

		el.textContent = 'abcx';
		placeCaret(el, 4);
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await editor.settle();

		expect(editor.source()).toBe('abc\\\nx\n');
	});

	it('a CRLF block’s break takes CRLF', async () => {
		const { editor, el } = await openBreak(mode, 1, 'abc\r\n');

		await pressKey(el, { key: 'x' });

		expect(editor.source()).toBe('abc\\\r\nx\r\n');
	});

	it('two Shift+Enters open two lines, and the key lands on the second', async () => {
		const { editor, el } = await openBreak(mode, 2, 'abc def\n');
		expect(editor.source()).toBe('abc def\n');

		await pressKey(el, { key: 'x' });

		expect(editor.source()).toBe('abc def\\\n\\\nx\n');
	});
});

describe('live mode: Shift+Enter in front of a hidden closer at the end', () => {
	// The caret paints at the line's end whichever side of the hidden `**` it reads.
	it('opens the line past the closer', async () => {
		const editor = mountEditor({ source: 'a **bold**\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, 8);
		await pressKey(el, { key: 'Enter', shiftKey: true });
		expect(editor.source()).toBe('a **bold**\n');

		await pressKey(el, { key: 'x' });

		expect(editor.source()).toBe('a **bold**\\\nx\n');
	});
});

describe.each(MODES)('%s mode: Shift+Enter where the line ends in structure', (mode) => {
	it.each([
		['a heading’s closing run stays on the heading’s line', '# Hi #\n', 6, '# Hi\\ #\nw\n'],
		['a setext underline stays under the text', 'Plan\n===\n', 4, 'Plan\\\nw\n===\n']
	])('%s', async (_label, source, at, written) => {
		const editor = mountEditor({ source, presentationMode: mode });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, at);
		await pressKey(el, { key: 'Enter', shiftKey: true });
		expect(editor.source()).toBe(source);

		await pressKey(el, { key: 'w' });

		expect(editor.source()).toBe(written);
	});
});
