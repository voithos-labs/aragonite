/**
 * Every write the editor makes to the system clipboard, and its reads outside a paste event. A copy
 * puts plain Markdown on the clipboard for every other app, and beside it the editor's own entry,
 * as a type of its own and as an in-memory copy matched by that text (a paste reads it back). A
 * refused call (a webview without clipboard access, a denied permission) changes nothing.
 */

import { tick } from 'svelte';
import { trimTrailingLineEnding } from '../core/lines';

/** The clipboard type the editor's own entry travels as; other apps read the text alone. */
export const OWN_CLIPBOARD_TYPE = 'application/x-aragonite-range';

/** What one copy writes: its text, the HTML table a rectangle of cells adds, and the editor's own
 *  entry for a copied range. */
export interface ClipboardWrite {
	text: string;
	html?: string;
	own?: string;
}

/** The last text the editor put on the clipboard and the entry that went with it. */
let lastWrite: { text: string; own?: string } | null = null;

/** Writes `write` into a copy or cut event's clipboard, the editor's own entry included. */
export function writeClipboardEvent(e: ClipboardEvent, write: ClipboardWrite): void {
	e.clipboardData?.setData('text/plain', write.text);
	if (write.html) e.clipboardData?.setData('text/html', write.html);
	if (write.own) e.clipboardData?.setData(OWN_CLIPBOARD_TYPE, write.own);
	lastWrite = { text: write.text, own: write.own };
}

/** Whether `write` reached the clipboard outside a copy event, inside the press's click. The async
 *  clipboard refuses a whole write holding a type of the editor's own, so the entry stays in memory. */
export async function writeClipboardPayload(write: ClipboardWrite): Promise<boolean> {
	if (typeof ClipboardItem !== 'function') return writeClipboardText(write);
	const items: Record<string, Blob> = { 'text/plain': blob(write.text, 'text/plain') };
	if (write.html) items['text/html'] = blob(write.html, 'text/html');
	try {
		await navigator.clipboard.write([new ClipboardItem(items)]);
	} catch {
		return false;
	}
	lastWrite = { text: write.text, own: write.own };
	return true;
}

/** A block's text on the clipboard (its Markdown, or a fence's code) without the line ending that
 *  closes it, so every route that copies one writes the same text. */
export function copyBlockToClipboard(raw: string): Promise<boolean> {
	return writeClipboardText({ text: trimTrailingLineEnding(raw) });
}

/** The clipboard's text, or null when the read is refused. It reads once a menu that just closed
 *  has left the page, since Safari draws its Paste prompt over whatever still shows. */
export async function readClipboardText(): Promise<string | null> {
	await tick();
	try {
		return await navigator.clipboard.readText();
	} catch {
		return null;
	}
}

/** The editor's own entry for clipboard text the editor wrote last; undefined for any other text. */
export function ownEntryFor(text: string): string | undefined {
	return lastWrite?.text === text ? lastWrite.own : undefined;
}

async function writeClipboardText(write: ClipboardWrite): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(write.text);
	} catch {
		return false;
	}
	lastWrite = { text: write.text, own: write.own };
	return true;
}

const blob = (value: string, type: string) => new Blob([value], { type });
