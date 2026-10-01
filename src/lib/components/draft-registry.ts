/**
 * The editor's open drafts: edits held outside the document until they commit (a shown source, a
 * diagram's edit box). Each is opened on the bytes it edits, and its commit asks `canWrite()`
 * first: a `source` swap or an outside write to those bytes drops it, and a block the swap tore
 * down still blurs, and so still tries to commit, after the swap has returned.
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
	/** The owner committed or dropped it, so the editor no longer closes it. Safe to repeat. */
	end(): void;
}

/** The document the editor holds now; `live` turns false once a swap replaces it. */
export interface DocumentLife {
	readonly live: boolean;
}

export interface DraftRegistry {
	open(spec: DraftSpec): Draft;
	/** For a blur write that holds no draft (a tidy-up of the block's own bytes). */
	documentLife(): DocumentLife;
	/** A document swap and a mode change call it. */
	closeAll(cause: DraftCloseCause): void;
}

export function createDraftRegistry(): DraftRegistry {
	let life = { live: true };
	const open = new Set<DraftSpec>();
	return {
		open(spec) {
			const openedOn = life;
			open.add(spec);
			return {
				canWrite: () => openedOn.live && spec.current() === spec.seed,
				end: () => void open.delete(spec)
			};
		},
		documentLife: () => life,
		closeAll(cause) {
			if (cause === 'document-swap') {
				life.live = false;
				life = { live: true };
			}
			for (const spec of [...open]) {
				open.delete(spec);
				spec.close(cause);
			}
		}
	};
}
