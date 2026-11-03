/**
 * The editor's reads and writes of the system clipboard outside a copy or paste event, and the text
 * a whole block copies as. A refused call (a webview without clipboard access, a denied permission,
 * a dismissed Paste prompt) is the host's business, so it resolves to nothing and changes nothing.
 */

import { tick } from 'svelte';
import { trimTrailingLineEnding } from '../core/lines';

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

/** What a copy writes: its text, and the HTML beside it when the copy has one. */
export interface ClipboardPayload {
	'text/plain': string;
	'text/html'?: string;
}

/** Whether `payload` reached the clipboard: both of its types where the browser takes several,
 *  its text alone where it takes only text. Call it inside the press's click, as every write. */
export async function writeClipboardPayload(payload: ClipboardPayload): Promise<boolean> {
	if (typeof ClipboardItem !== 'function') return writeClipboardText(payload['text/plain']);
	const items: Record<string, Blob> = {};
	for (const [type, value] of Object.entries(payload))
		if (value) items[type] = new Blob([value], { type });
	try {
		await navigator.clipboard.write([new ClipboardItem(items)]);
		return true;
	} catch {
		return false;
	}
}

/** Whether `text` reached the clipboard. */
export async function writeClipboardText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** A block's Markdown on the clipboard, without the line ending that closes it, so every route
 *  that copies one block writes the same text. */
export function copyBlockToClipboard(raw: string): Promise<boolean> {
	return writeClipboardText(trimTrailingLineEnding(raw));
}
