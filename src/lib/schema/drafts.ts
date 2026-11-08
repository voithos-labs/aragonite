/**
 * A draft: an edit held outside the document until it commits, a plugin's or a host's write, a
 * shown source, a diagram's edit box. Its positions are byte offsets into the document's text as it
 * stood when the draft opened, and its commit lands as one undo step or is refused with a reason.
 */

/** What a draft's commit came to: landed, or refused with the reason. */
export type DraftResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: 'moved' | 'unloaded' | 'reading' | 'overlap' | 'illegal' | 'empty';
			readonly message: string;
	  };

/** An edit against the document as it stood when opened, committed as one undo step or refused. */
export interface Draft {
	/** True once a write elsewhere touched bytes it holds (its block's, for a block's draft), or
	 *  another document replaced the one it opened on. */
	readonly stale: boolean;
	/** Replace bytes `from` to `to` with `text`, a new line inside a container carrying its marker;
	 *  an opener written above a block that would close it gets its closing line from the editor. */
	replace(range: { readonly from: number; readonly to: number }, text: string): this;
	/** Insert Markdown at the caret the way a paste would, once the replacements land. */
	insert(markdown: string): this;
	/** Write it all as one undo step, the caret at byte `caret` of the text as written (past any
	 *  closing line the editor added above it) or left where it is. */
	commit(options?: { caret?: number }): Promise<DraftResult>;
	/** Drop it, writing nothing: a closed edit box, a wait given up on. */
	end(): void;
}

/** Why the editor closes its drafts: a `source` swap drops them; a mode change, or an undo or redo
 *  about to replace the document, can still save them. */
export type DraftCloseCause = 'mode-change' | 'undo' | 'document-swap';

/** A block's draft, closed by the editor when it swaps the document, switches modes or undoes. */
export interface DraftSpec {
	/** At a swap it must write nothing. */
	close(cause: DraftCloseCause): void;
}
