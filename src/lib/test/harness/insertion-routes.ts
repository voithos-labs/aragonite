// Every way text reaches a prose block's caret, driven the way a browser delivers it: a hardware key
// (keydown, then beforeinput, then the browser's own insert), a soft keyboard (beforeinput with no
// keydown, or after one that names no key, as Android sends), an autocorrect replacement, an IME
// commit, and a paste. jsdom inserts nothing itself, so the insert is done here at the DOM caret.

import { settleEditor } from './settle';

export type InsertionRoute =
	| 'hardware key'
	| 'soft key'
	| 'soft key after an unnamed keydown'
	| 'replacement'
	| 'composition'
	| 'paste';

export const INSERTION_ROUTES: readonly InsertionRoute[] = [
	'hardware key',
	'soft key',
	'soft key after an unnamed keydown',
	'replacement',
	'composition',
	'paste'
];

/** Insert `text` at `el`'s caret by `route`, one character at a time where the route types, and
 *  wait for the writes to land. */
export async function insertBy(
	route: InsertionRoute,
	el: HTMLElement,
	text: string
): Promise<void> {
	if (route === 'composition') return compose(el, text);
	if (route === 'paste') return paste(el, text);
	for (const ch of text) {
		if (route === 'hardware key' || route === 'soft key after an unnamed keydown') {
			const name = route === 'hardware key' ? ch : 'Unidentified';
			const key = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
			el.dispatchEvent(key);
			// The keydown handler awaits before its key arms run, as it does in the browser.
			await settleEditor();
			if (key.defaultPrevented) continue;
		}
		const inputType = route === 'replacement' ? 'insertReplacementText' : 'insertText';
		await inputEvent(el, inputType, ch);
	}
}

/** A `beforeinput` of `inputType`, then the browser's insert and `input` unless it was prevented. */
async function inputEvent(el: HTMLElement, inputType: string, data: string): Promise<void> {
	const before = new InputEvent('beforeinput', {
		inputType,
		data,
		bubbles: true,
		cancelable: true
	});
	el.dispatchEvent(before);
	if (!before.defaultPrevented) {
		insertAtCaret(data);
		el.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }));
	}
	await settleEditor();
}

async function compose(el: HTMLElement, text: string): Promise<void> {
	el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	insertAtCaret(text);
	el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
	await settleEditor();
}

async function paste(el: HTMLElement, text: string): Promise<void> {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	el.dispatchEvent(e);
	await settleEditor();
}

/** The browser's insert: `text` at the collapsed DOM caret, the caret left after it. */
function insertAtCaret(text: string): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) throw new Error('no caret to insert at');
	const range = selection.getRangeAt(0);
	const { startContainer, startOffset } = range;
	const node =
		startContainer instanceof Text ? startContainer : insertTextNode(startContainer, startOffset);
	const at = startContainer instanceof Text ? startOffset : 0;
	node.insertData(at, text);
	const caret = document.createRange();
	caret.setStart(node, at + text.length);
	caret.collapse(true);
	selection.removeAllRanges();
	selection.addRange(caret);
}

function insertTextNode(parent: Node, offset: number): Text {
	const node = document.createTextNode('');
	parent.insertBefore(node, parent.childNodes[offset] ?? null);
	return node;
}
