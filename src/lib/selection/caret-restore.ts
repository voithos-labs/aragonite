/**
 * Hold the document caret while editor-owned chrome borrows focus, and put it back on close.
 * Focusing an overlay's input collapses the native selection, so the range has to live somewhere
 * that outlives the borrow — search opened the shape, the link card is the second door.
 */

export interface CaretRestore {
	/** Snapshot the live caret. Null clears the slot, which makes `restore` fall back to the root. */
	save(range: Range | null): void;
	/** Snapshot the live caret from the window selection — the usual door. */
	saveCurrent(): void;
	/** Re-seat the saved caret and focus its host leaf. A container the DOM no longer holds falls
	 *  back to the editor root, so cross-block keyboard routing survives a rebuild. */
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
