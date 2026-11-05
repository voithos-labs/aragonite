// Every gesture the range-edit laws name, driven the way a browser delivers it to the mounted
// editor: the keydown first, then, only where nothing prevented it, the clipboard event or the input
// the browser would send; a menu row by its press; `insertMarkdown` through the instance.

import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	mountEditor,
	selectRange,
	surfaceAt,
	placeCaret,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey, settleEditor } from '#lib/test/harness/settle.js';
import {
	StubDataTransfer,
	dispatchClipboardEvent,
	setCommandFires,
	systemClipboard,
	takeCommandClipboard
} from '#lib/test/harness/clipboard-events.js';
import {
	insertBy,
	pressHardwareKey,
	type InsertionRoute
} from '#lib/test/harness/insertion-routes.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';

export type Editor = MountedEditor<EditorTestSurface>;
export type Payload = Record<string, string>;

/** Where a copy or cut comes from: the chord at the focused element, the chord with the event
 *  aimed at the page body (Chromium's target with no caret at the range's end), or a menu row,
 *  its command firing or not (WebKit's, which fires nothing over the editor's own range). */
export type ClipboardRoute = 'key' | 'key at body' | 'menu' | 'menu without command';
export const CLIPBOARD_ROUTES: readonly ClipboardRoute[] = [
	'key',
	'key at body',
	'menu',
	'menu without command'
];

export type PasteRoute = 'key' | 'menu' | 'insertMarkdown';
export const PASTE_ROUTES: readonly PasteRoute[] = ['key', 'menu', 'insertMarkdown'];

export type TypingRoute = Extract<InsertionRoute, 'hardware key' | 'soft key' | 'composition'>;
export const TYPING_ROUTES: readonly TypingRoute[] = ['hardware key', 'soft key', 'composition'];

/** A key typed over a range: a character by a typing route, or Enter by the hardware key. */
export type TypedKey = { text: string; route: TypingRoute } | { key: 'Enter' };

export function mountCase(source: string, mode: PresentationMode): Editor {
	return mountEditor<EditorTestSurface>({
		source,
		presentationMode: mode,
		plugins: SYNTAX_PLUGINS
	});
}

const sameSelection = (a: EditorSelection | null, b: EditorSelection) =>
	!!a && JSON.stringify(a) === JSON.stringify(b);

/** Puts `range` down the way a user gets it there: a native range inside one block's text, the
 *  editor's own range across blocks. True once `getSelection()` reads it back. */
export async function placeRange(editor: Editor, range: EditorSelection): Promise<boolean> {
	const { anchor, focus } = range;
	const samePath = JSON.stringify(anchor.path) === JSON.stringify(focus.path);
	try {
		if (samePath && !anchor.cellCoordinate && !focus.cellCoordinate) {
			const el = surfaceAt(editor, anchor.path);
			if (anchor.offset === focus.offset) placeCaret(el, anchor.offset);
			else selectRange(el, anchor.offset, focus.offset);
		} else {
			// Resolves false in jsdom even once placed, since its scroll never arrives.
			await editor.instance.setSelection(range);
		}
	} catch {
		return false;
	}
	await editor.settle();
	return sameSelection(editor.instance.getSelection(), range);
}

const focused = (): HTMLElement => (document.activeElement as HTMLElement | null) ?? document.body;

// jsdom reports no platform, so the editor reads Ctrl as the command key.
const chord = (key: string): KeyboardEventInit => ({ key, ctrlKey: true });

// ── Copy and cut ─────────────────────────────────────────────────────────────

/** What a copy or cut wrote, by type; empty when nothing was written. */
export async function clipboardGesture(
	editor: Editor,
	type: 'copy' | 'cut',
	route: ClipboardRoute
): Promise<Payload> {
	systemClipboard.clear();
	if (route === 'menu' || route === 'menu without command') {
		setCommandFires(route === 'menu');
		await pickMenuRow(editor, type === 'copy' ? 'Copy' : 'Cut');
		setCommandFires(true);
		const command = takeCommandClipboard();
		return command && command.data.size > 0
			? Object.fromEntries(command.data)
			: Object.fromEntries(systemClipboard);
	}
	const at = focused();
	const key = dispatchKey(at, chord(type === 'copy' ? 'c' : 'x'));
	if (key.defaultPrevented) {
		await editor.settle();
		return Object.fromEntries(systemClipboard);
	}
	const data = new StubDataTransfer();
	// Chromium aims the event at the body only where the selection's end has no caret: a range or
	// a widget the editor holds. A range in one block's text gets it at that block.
	const atBody = route === 'key at body' && editor.instance.__test.ownsRange();
	dispatchClipboardEvent(atBody ? document.body : at, type, data);
	await editor.settle();
	return Object.fromEntries(data.data);
}

// ── Paste ────────────────────────────────────────────────────────────────────

/** Pastes `payload` at the editor's selection by `route`. */
export async function pasteGesture(
	editor: Editor,
	payload: Payload,
	route: PasteRoute
): Promise<void> {
	systemClipboard.clear();
	for (const [type, value] of Object.entries(payload)) systemClipboard.set(type, value);
	if (route === 'insertMarkdown') {
		await editor.instance.insertMarkdown(payload['text/plain'] ?? '');
		await editor.settle();
		return;
	}
	if (route === 'menu') return pickMenuRow(editor, 'Paste');
	const at = focused();
	if (dispatchKey(at, chord('v')).defaultPrevented) return editor.settle();
	dispatchClipboardEvent(at, 'paste', new StubDataTransfer(payload));
	await editor.settle();
}

/** The menu's Paste as plain text over the editor's selection. */
export async function pastePlainGesture(editor: Editor, text: string): Promise<void> {
	systemClipboard.clear();
	systemClipboard.set('text/plain', text);
	await pickMenuRow(editor, 'Paste as plain text');
}

/** Opens the menu over the focused element, as a right-click on the selection does, and picks
 *  the row labelled `label`. jsdom aims no pointer, so the press keeps the selection it has. */
async function pickMenuRow(editor: Editor, label: string): Promise<void> {
	const held = editor.instance.getSelection();
	focused().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	await editor.settle();
	// The press may have dropped a collapsed caret where jsdom's zero-size boxes put it.
	if (held && JSON.stringify(editor.instance.getSelection()) !== JSON.stringify(held)) {
		await placeRange(editor, held);
	}
	const row = [...document.querySelectorAll<HTMLButtonElement>('.md-menu [role="menuitem"]')].find(
		(el) => el.textContent?.trim() === label
	);
	// jsdom sends no secondary press, so the menu can't tell whether one landed on the range.
	if (!row) throw new Undetermined(`no "${label}" row in the menu jsdom opened`);
	if (row.disabled) throw new Undetermined(`"${label}" row disabled in the menu jsdom opened`);
	row.click();
	// A row's clipboard read and its write each wait a turn before the paste starts.
	await editor.settle();
	await editor.settle();
}

/** A gesture jsdom can't drive the way a browser would, so the run decides nothing. */
export class Undetermined extends Error {}

// ── Typing and deleting ──────────────────────────────────────────────────────

/** Types `typed` at the editor's selection; false where the browser would have acted and jsdom
 *  can't (a key nothing prevented that the editor leaves to the browser). */
export async function typeGesture(editor: Editor, typed: TypedKey): Promise<boolean> {
	if ('key' in typed) {
		const took = await pressHardwareKey(focused(), { key: typed.key });
		await editor.settle();
		return took !== 'browser';
	}
	await insertBy(typed.route, focused(), typed.text);
	await editor.settle();
	return true;
}

/** Backspace or Delete at the editor's selection; false where only the browser would act. */
export async function deleteGesture(editor: Editor, key: 'Backspace' | 'Delete'): Promise<boolean> {
	const took = await pressHardwareKey(focused(), { key });
	await editor.settle();
	return took !== 'browser';
}

// ── History ──────────────────────────────────────────────────────────────────

/** Undo or redo by its chord at the focused element, as a person presses it. */
export async function runHistory(editor: Editor, command: 'undo' | 'redo') {
	const init = command === 'undo' ? { key: 'z', ctrlKey: true } : { key: 'y', ctrlKey: true };
	const took = await pressHardwareKey(focused(), init);
	if (took === 'browser') editor.instance.runCommand(`history.${command}`);
	await editor.settle();
	await settleEditor();
}
