/**
 * The clipboard rows a menu offers: cut and copy as Ctrl+C would write them, and paste as the
 * clipboard's text handed to the focused block's paste step, as Markdown or as plain text, which
 * the block escapes where it reads Markdown. Run a row inside its press's click.
 */

import {
	readClipboardText,
	writeClipboardPayload,
	type ClipboardPayload
} from '../../editor-actions/system-clipboard';
import type { AimedInsert } from '../editor-root/focused-surface';

export type ClipboardAction = 'cut' | 'copy' | 'paste' | 'paste-plain';

/** What a menu's clipboard rows act through. */
export interface MenuClipboard {
	/** A Cut or Copy of the range the editor holds (`EditorRootClipboard.takeForMenu`), or null
	 *  for a range the browser holds, which its own command copies. */
	take(action: 'cut' | 'copy'): ClipboardPayload | null;
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
			// Over a range the editor holds only a caret stands, where WebKit's command copies nothing.
			const payload = clipboard.take(action);
			if (payload) void writeClipboardPayload(payload);
			else document.execCommand(action);
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
