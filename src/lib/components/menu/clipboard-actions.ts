/**
 * The clipboard rows a menu offers: cut and copy as Ctrl+C would write them, and paste as the
 * clipboard's text handed to the focused block's paste step, as Markdown or as plain text, which
 * the block escapes where it reads Markdown. Run a row inside its press's click.
 */

import {
	readClipboardText,
	writeClipboardPayload,
	type ClipboardWrite
} from '../../browser/clipboard';
import type { AimedInsert } from '../editor-root/focused-surface';

export type ClipboardAction = 'cut' | 'copy' | 'paste' | 'paste-plain';

/** What a Cut or Copy of the range the editor holds writes, and the removal a Cut runs after. */
export interface MenuTake {
	write: ClipboardWrite;
	remove(): Promise<void>;
}

/** What a menu's clipboard rows act through. */
export interface MenuClipboard {
	/** The range the editor holds (`EditorRootClipboard.takeForMenu`), or null for a range the
	 *  browser holds, which its own command copies. */
	take(): MenuTake | null;
	/** The block a Paste inserts into, aimed now; null with none focused. */
	pasteTarget(): AimedInsert | null;
}

export async function runClipboardAction(
	action: ClipboardAction,
	clipboard: MenuClipboard
): Promise<void> {
	switch (action) {
		case 'cut':
		case 'copy': {
			if (copyStepTookCommand(action)) return;
			// WebKit's command fires nothing over the lone caret under a range the editor holds.
			const taken = clipboard.take();
			if (!taken) return;
			// A refused write changes nothing, so a Cut whose write was refused keeps its range.
			if ((await writeClipboardPayload(taken.write)) && action === 'cut') await taken.remove();
			return;
		}
		case 'paste':
		case 'paste-plain': {
			const paste = clipboard.pasteTarget();
			if (!paste) return;
			const text = await readClipboardText();
			if (!text) return;
			await (action === 'paste-plain' ? paste.plainText(text) : paste.markdown(text));
		}
	}
}

// The browser's own command first: its event carries the clipboard with no permission asked, so a
// frame without one still copies. Every editor copy step cancels the event it writes into.
function copyStepTookCommand(action: 'cut' | 'copy'): boolean {
	let heard = null as Event | null;
	const listen = (e: Event) => void (heard = e);
	document.addEventListener(action, listen, true);
	try {
		document.execCommand(action);
	} finally {
		document.removeEventListener(action, listen, true);
	}
	return heard?.defaultPrevented ?? false;
}
