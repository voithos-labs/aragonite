// Every way text reaches a prose block's caret, driven the way a browser delivers it: a hardware key
// (keydown, then beforeinput, then the browser's own insert), a soft keyboard (beforeinput with no
// keydown, or after one that names no key, as Android sends), an autocorrect replacement, an IME
// commit, and a paste; plus any other hardware key, sent the same way. jsdom inserts nothing
// itself, so the insert is done here at the DOM caret.

import { settleEditor } from './settle';
import { surfaceAt, type MountedEditor } from './mount-editor.svelte';
import { cellAt } from '../blocks/table/mount-table';

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
		if (route === 'hardware key') {
			await pressHardwareKey(el, { key: ch });
			continue;
		}
		if (route === 'soft key after an unnamed keydown') {
			if (await keydownTaken(el, { key: 'Unidentified' })) continue;
		}
		const inputType = route === 'replacement' ? 'insertReplacementText' : 'insertText';
		await inputEvent(el, inputType, ch);
	}
}

/** Who acted on a hardware key: the editor at keydown or at `beforeinput`, the browser's insert
 *  of a printable key, or a default action jsdom has no engine for (a delete, a break, Tab). */
export type KeyOutcome = 'keydown' | 'beforeinput' | 'inserted' | 'browser';

/** One hardware key at `el`'s caret: keydown, `beforeinput`, then a printable key's insert, each
 *  only if the one before went unprevented. Any other default action is left undone. */
export async function pressHardwareKey(
	el: HTMLElement,
	init: KeyboardEventInit
): Promise<KeyOutcome> {
	if (await keydownTaken(el, init)) return 'keydown';
	const inputType = beforeInputTypeOf(init);
	if (inputType === null) return 'browser';
	if (inputType === 'insertText') {
		const taken = await inputEvent(el, inputType, init.key!);
		return taken ? 'beforeinput' : 'inserted';
	}
	const before = dispatchBeforeInput(el, inputType);
	await settleEditor();
	return before.defaultPrevented ? 'beforeinput' : 'browser';
}

async function keydownTaken(el: HTMLElement, init: KeyboardEventInit): Promise<boolean> {
	const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(key);
	// The keydown handler awaits before its key arms run, as it does in the browser.
	await settleEditor();
	return key.defaultPrevented;
}

/** The `beforeinput` a browser sends after an unprevented keydown; null for a key that sends none. */
function beforeInputTypeOf({ key, shiftKey, ctrlKey, metaKey, altKey }: KeyboardEventInit) {
	if (key === 'Enter') return shiftKey ? 'insertLineBreak' : 'insertParagraph';
	if (key === 'Backspace') return 'deleteContentBackward';
	if (key === 'Delete') return 'deleteContentForward';
	const printable = key !== undefined && [...key].length === 1;
	return printable && !ctrlKey && !metaKey && !altKey ? 'insertText' : null;
}

/** Text dragged in from outside the editor and dropped at `el`'s caret, which jsdom can't aim by
 *  pointer: the browser's `insertFromDrop`, then its insert. */
export async function dropAtCaret(el: HTMLElement, text: string): Promise<void> {
	await inputEvent(el, 'insertFromDrop', text);
}

/** A `beforeinput` sent to `el` as the browser sends it, aimed at `target` when one is given.
 *  Returned, so a test can read whether the editor prevented it. */
export function dispatchBeforeInput(
	el: HTMLElement,
	inputType: string,
	opts: { data?: string; target?: Range } = {}
): InputEvent {
	const e = new InputEvent('beforeinput', {
		inputType,
		data: opts.data,
		bubbles: true,
		cancelable: true
	});
	const { target } = opts;
	if (target) Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
	el.dispatchEvent(e);
	return e;
}

/** A paste of plain `text` sent to `el`. jsdom has no DataTransfer, so the event carries a
 *  clipboard holding that text alone. */
export function dispatchPaste(el: HTMLElement, text: string): Event {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	const clipboardData = {
		types: ['text/plain'],
		files: [],
		items: [],
		getData: (type: string) => (type === 'text/plain' ? text : '')
	};
	Object.defineProperty(e, 'clipboardData', { value: clipboardData });
	el.dispatchEvent(e);
	return e;
}

/** A paste carrying one PNG file and no text, sent to `el`. */
export function dispatchImagePaste(el: HTMLElement): Event {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	const files = [new File([new Uint8Array([137, 80])], 'shot.png', { type: 'image/png' })];
	Object.defineProperty(e, 'clipboardData', {
		value: { types: ['Files'], files, items: [], getData: () => '' }
	});
	el.dispatchEvent(e);
	return e;
}

/** A `beforeinput` of `inputType`, then the browser's insert and `input` unless it was prevented;
 *  true when it was. */
async function inputEvent(el: HTMLElement, inputType: string, data: string): Promise<boolean> {
	const before = dispatchBeforeInput(el, inputType, { data });
	if (!before.defaultPrevented) {
		insertAtCaret(data);
		el.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }));
	}
	await settleEditor();
	return before.defaultPrevented;
}

async function compose(el: HTMLElement, text: string): Promise<void> {
	el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	insertAtCaret(text);
	el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
	await settleEditor();
}

async function paste(el: HTMLElement, text: string): Promise<void> {
	dispatchPaste(el, text);
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

/** The two prose surfaces text is typed into, each holding one `line` at the same offsets: a
 *  paragraph, and a table cell, which wires the same steps on its own. */
export const TEXT_HOSTS = [
	{
		name: 'a paragraph',
		source: (line: string) => `${line}\n`,
		el: (editor: MountedEditor) => surfaceAt(editor, [0]),
		line: (source: string) => source.replace(/\n$/, '')
	},
	{
		name: 'a table cell',
		source: (line: string) => `| h |\n| - |\n| ${line} |\n`,
		el: (editor: MountedEditor) => cellAt(editor, 1, 0),
		line: (source: string) => /\n\| (.*) \|\n$/.exec(source)?.[1] ?? source
	}
];
