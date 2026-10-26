/**
 * A draft: an edit held outside the document until it commits (a shown source, a textarea's text).
 * `EditorContext.openDraft` opens one; its commit asks `canWrite()` first, since a `source` swap or
 * a write to the bytes it was seeded from drops it.
 */

/** Why the editor closes its drafts: a `source` swap drops them; a mode change, or an undo or redo
 *  about to replace the document, can still save them. */
export type DraftCloseCause = 'mode-change' | 'undo' | 'document-swap';

export interface DraftSpec {
	/** The bytes the draft was opened on. */
	seed: string;
	/** Those bytes now: a draft whose bytes moved under it writes nothing. */
	current(): string;
	/** Runs when the editor closes a draft still open; at a swap it must write nothing. */
	close(cause: DraftCloseCause): void;
}

export interface Draft {
	/** Whether the commit may write: the document it opened on is still in place, its bytes too. */
	canWrite(): boolean;
	/** Unregister it once the owner closes it or unmounts, so the editor never closes it on a box
	 *  that's gone; safe to repeat. */
	end(): void;
}
