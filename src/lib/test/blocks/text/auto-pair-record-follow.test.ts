// @vitest-environment jsdom
// The auto-pair owns only the empty pair it wrote, and only while nothing else has written over
// it: a write that takes the pair apart ends the record, so bytes rebuilt by hand are the user's.
// Miss-analysis: GH #478, the record was only ever consulted by the auto-pair's own keys, so no
// case wrote the pair apart by another route and rebuilt it before the next delimiter key.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '../../harness/mount-editor.svelte';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** A typed character as the browser delivers it: the editor's handler, else the native insert. */
async function typeAt(editor: MountedEditor, el: HTMLElement, caret: number, char: string) {
	placeCaret(el, caret);
	const e = new InputEvent('beforeinput', {
		inputType: 'insertText',
		data: char,
		bubbles: true,
		cancelable: true
	});
	el.dispatchEvent(e);
	await editor.settle();
	if (e.defaultPrevented) return;
	const text = el.textContent ?? '';
	nativeEdit(el, text.slice(0, caret) + char + text.slice(caret), caret + 1);
	await editor.settle();
}

/** What the browser leaves after its own edit: the new text and the caret, then `input`. */
function nativeEdit(el: HTMLElement, text: string, caret: number) {
	el.textContent = text;
	placeCaret(el, caret);
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

async function pasteAt(editor: MountedEditor, el: HTMLElement, caret: number, text: string) {
	placeCaret(el, caret);
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	el.dispatchEvent(e);
	await editor.settle();
}

describe('the auto-pair record follows every write', () => {
	it('a pair rebuilt by forward delete and paste is the user’s', async () => {
		const editor = mountEditor({ source: 'a \n' });
		const el = surfaceAt(editor, [0]);

		await typeAt(editor, el, 2, '*');
		expect(editor.source()).toBe('a **\n');
		// The forward delete takes the partner the auto-pair wrote.
		nativeEdit(el, 'a *', 3);
		await editor.settle();
		expect(editor.source()).toBe('a *\n');
		await pasteAt(editor, el, 3, '*');
		expect(editor.source()).toBe('a **\n');

		await typeAt(editor, el, 3, ' ');

		expect(editor.source()).toBe('a * *\n');
	});
});
