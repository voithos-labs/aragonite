/**
 * Saves the document caret while a menu or overlay input borrows focus, and puts it back on
 * close. Focusing the overlay's input collapses the native selection, so the range has to be
 * held somewhere that outlives the borrow.
 */

export interface CaretRestore {
	/** Saves the live caret. Null clears it, so `restore` falls back to focusing the editor root. */
	save(range: Range | null): void;
	/** Saves the caret from the window selection; the usual entry point. */
	saveCurrent(): void;
	/** Puts the saved caret back and focuses its editable host. A range whose container has left
	 *  the DOM falls back to the editor root, so keyboard routing survives a rebuild. */
	restore(): void;
}

export function createCaretRestore(getEditorEl: () => HTMLElement | null): CaretRestore {
	let saved: Range | null = null;

	return {
		save(range) {
			saved = range;
		},
		saveCurrent() {
			const selection = window.getSelection();
			saved = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
		},
		restore() {
			const editorEl = getEditorEl();
			if (saved && editorEl?.contains(saved.startContainer)) {
				const node = saved.startContainer;
				const host = node instanceof Element ? node : node.parentElement;
				host?.closest<HTMLElement>('[contenteditable]')?.focus();
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(saved);
			} else {
				editorEl?.focus();
			}
			saved = null;
		}
	};
}
