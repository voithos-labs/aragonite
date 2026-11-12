/**
 * Every write the editor makes to the system clipboard, and its reads outside a paste event. A copy
 * puts plain Markdown on the clipboard for every other app, and beside it the editor's own entry,
 * as a type of its own and as an in-memory copy matched by that text (a paste reads it back). A
 * refused call (a webview without clipboard access, a denied permission) changes nothing.
 */

import { tick } from 'svelte';
import { normalizeLineEndings, trimTrailingLineEnding } from '../core/lines';

/** The clipboard type the editor's own entry travels as; other apps read the text alone. */
export const OWN_CLIPBOARD_TYPE = 'application/x-aragonite-range';

/** What one copy writes: its text, the HTML table a rectangle of cells adds, and the editor's own
 *  entry for a copied range. */
export interface ClipboardWrite {
	text: string;
	html?: string;
	own?: string;
}

/** What one paste read: its text with LF line endings, whether it goes in as plain text, the
 *  editor's own entry where the clipboard holds one, and everything else the clipboard carried. */
export interface ClipboardRead {
	text: string;
	plain: boolean;
	own?: string;
	/** Every string type of a paste event's data, as written. */
	types: Readonly<Record<string, string>>;
	files: readonly File[];
}

/** The last text the editor put on the clipboard, its line endings LF, and the entry that went
 *  with it. */
let lastWrite: { text: string; own?: string } | null = null;

const wrote = (write: ClipboardWrite): void => {
	lastWrite = { text: normalizeLineEndings(write.text), own: write.own };
};

/** A paste event's clipboard, read whole before the handler first waits; `plain` where the
 *  paste's own chord asked for plain text. */
export function readPasteEvent(e: ClipboardEvent, plain = false): ClipboardRead {
	const data = e.clipboardData;
	const types = Object.fromEntries((data?.types ?? []).map((type) => [type, data!.getData(type)]));
	return clipOf(types['text/plain'] ?? '', plain, types, Array.from(data?.files ?? []));
}

/** A menu's read, the text alone; null when refused. It waits for a menu that just closed to
 *  leave the page, since Safari draws its Paste prompt over whatever still shows. */
export async function readClipboard(plain = false): Promise<ClipboardRead | null> {
	await tick();
	try {
		return clipOf(await navigator.clipboard.readText(), plain);
	} catch {
		return null;
	}
}

/** Text a caller hands over as a paste would bring it, with no clipboard read and no entry. */
export const scriptedClip = (text: string, plain = false): ClipboardRead => ({
	text: normalizeLineEndings(text),
	plain,
	types: {},
	files: []
});

function clipOf(
	raw: string,
	plain: boolean,
	types: Record<string, string> = {},
	files: File[] = []
): ClipboardRead {
	const text = normalizeLineEndings(raw);
	const own = types[OWN_CLIPBOARD_TYPE] || ownEntryFor(text);
	return { text, plain, ...(own && { own }), types, files };
}

/** Writes `write` into a copy or cut event's clipboard, the editor's own entry included. */
export function writeClipboardEvent(e: ClipboardEvent, write: ClipboardWrite): void {
	e.clipboardData?.setData('text/plain', write.text);
	if (write.html) e.clipboardData?.setData('text/html', write.html);
	if (write.own) e.clipboardData?.setData(OWN_CLIPBOARD_TYPE, write.own);
	wrote(write);
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
	wrote(write);
	return true;
}

/** A block's text on the clipboard (its Markdown, or a fence's code) without its closing line
 *  ending, so every route that copies one writes the same text; an own entry stays in memory. */
export function copyBlockToClipboard(write: ClipboardWrite): Promise<boolean> {
	return writeClipboardText({ ...write, text: trimTrailingLineEnding(write.text) });
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

/** The editor's own entry for clipboard text the editor wrote last, compared with LF line endings
 *  on both sides, since the system may rewrite them; undefined for any other text. */
export function ownEntryFor(text: string): string | undefined {
	return lastWrite?.text === text ? lastWrite.own : undefined;
}

async function writeClipboardText(write: ClipboardWrite): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(write.text);
	} catch {
		return false;
	}
	wrote(write);
	return true;
}

const blob = (value: string, type: string) => new Blob([value], { type });
