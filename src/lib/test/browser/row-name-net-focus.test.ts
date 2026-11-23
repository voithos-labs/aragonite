// @vitest-environment jsdom
// A caret stepped into a `:::` row's name stays there while the window loses focus and gets it back,
// since the row stays the focused element; focus that leaves the row makes the next caret an arrival.
// Miss-analysis: the net's focus-leave rows moved focus to a field on the page; none took focus from
// the window, where the row keeps focus and the browser still sends `focusout`.
import { afterEach, beforeAll, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { rawOffsetAt } from '#lib/browser/offsets.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

async function rowWithCaretInName() {
	const editor = mountEditor({
		source: ':::tip Title\nbody\n:::\n',
		presentationMode: 'live',
		plugins: [admonitionsPlugin()]
	});
	await editor.settle();
	const row = surfaceAt(editor, [0, 0]);
	// A step leaves the title's start, then the name; jsdom fires no `selectionchange` of its own.
	for (const at of [7, 5]) await browserCaret(editor, row, at);
	return { editor, row };
}

async function browserCaret(editor: { settle(): Promise<void> }, row: HTMLElement, at: number) {
	placeCaret(row, at);
	await announce(editor);
}

async function announce(editor: { settle(): Promise<void> }) {
	document.dispatchEvent(new Event('selectionchange'));
	await editor.settle();
}

function caretIn(row: HTMLElement): number | null {
	const sel = window.getSelection();
	return sel?.focusNode && row.contains(sel.focusNode)
		? rawOffsetAt(row, sel.focusNode, sel.focusOffset)
		: null;
}

it('a window switch leaves a stepped caret in the name', async () => {
	const { editor, row } = await rowWithCaretInName();
	expect(caretIn(row)).toBe(5);
	// The window losing focus and getting it back: the row stays focused, and these still arrive.
	for (const type of ['blur', 'focusout', 'focus', 'focusin']) {
		row.dispatchEvent(new FocusEvent(type, { bubbles: type.startsWith('focus') }));
	}
	expect(document.activeElement).toBe(row);
	await announce(editor);
	expect(caretIn(row)).toBe(5);
});

it('focus that leaves the row and comes back makes a caret in the name an arrival', async () => {
	const { editor, row } = await rowWithCaretInName();
	const field = document.body.appendChild(document.createElement('input'));
	field.focus();
	await editor.settle();
	await browserCaret(editor, row, 5);
	expect(caretIn(row)).toBe(7);
});
