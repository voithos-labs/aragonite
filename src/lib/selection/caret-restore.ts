/**
 * Saves the document selection while a menu or overlay input borrows focus, and puts it back on
 * close through the caret landing's `restore`, by document path, so it survives the block being
 * windowed out or rebuilt meanwhile.
 */

import type { EditorSelection } from './primitives';
import type { SelectionRestoreOutcome } from './selection-restore';

export interface CaretRestore {
	/** Saves the editor's selection as it stands, or nothing when no block holds a caret. */
	saveCurrent(): void;
	/** Puts the saved selection back and brings it into view; with nothing saved, or when it no
	 *  longer lands, focuses the editor root so the keyboard still reaches the editor. */
	restore(): Promise<void>;
}

export interface CaretRestoreDeps {
	getEditorEl(): HTMLElement | null;
	/** The editor's selection, as `getSelection()` reads it. */
	read(): EditorSelection | null;
	/** The caret landing's `restore`. */
	restore(selection: EditorSelection): Promise<SelectionRestoreOutcome>;
}

export function createCaretRestore(deps: CaretRestoreDeps): CaretRestore {
	let saved: EditorSelection | null = null;

	return {
		saveCurrent() {
			saved = deps.read();
		},
		async restore() {
			const selection = saved;
			saved = null;
			if (selection && (await deps.restore(selection)) === 'applied') return;
			deps.getEditorEl()?.focus({ preventScroll: true });
		}
	};
}
