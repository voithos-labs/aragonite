/**
 * A draft: an edit held outside the document until it commits (a shown source, a textarea's text).
 * `EditorContext.openDraft` opens one; its commit asks `canWrite()` first, since a `source` swap or
 * a write to the bytes it was seeded from drops it.
 */

/** Why the editor closes its drafts: a swap drops them, a mode change can still save them. */
export type DraftCloseCause = 'mode-change' | 'document-swap';

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
	/** Unregister it once the owner closes it, so the editor won't close it again; safe to repeat. */
	end(): void;
}
