/**
 * Reveal-target anchor. While a programmatic reveal is active, the top-level
 * windowing scope's `correctAnchor` holds the reveal target's screen position
 * instead of the top-of-viewport block — so async image-decode churn above the
 * target can't shrink the document and clamp the scroll off it. Mirrors the
 * sticky-column state shape (`cursor/sticky-column.ts`); plain closed-over value,
 * read imperatively by `correctAnchor`, never reactive `$state`.
 *
 * The target carries its FULL path (a nested target is not its container) and its
 * `block` placement, so `correctAnchor` re-asserts the position the reveal asked
 * for: `'nearest'` top-pins the target (search's band, and `scrollTo`'s default);
 * `'center'` re-centers it every measure pass, so a `{ block: 'center' }` scroll
 * survives the same shrink a top-pin does.
 *
 * One slot, but per-call ownership: `claim` mints a handle that supersedes the
 * previous claimant, and a claimant may release only the pin it still holds. That
 * is what keeps a stale reveal's terminal release — a `'center'` refine, a failed
 * mount, a consumer restore handing the viewport back — from nuking a pin armed
 * after it. The user outranks every claimant: a keydown / pointerdown / wheel in
 * the document `releaseAll`s, so normal-scroll anchoring is untouched. NOT on
 * `scroll`, which a programmatic `correctAnchor` write itself fires.
 *
 * Losing the pin and being SUPERSEDED are deliberately different facts. Losing the
 * pin says the slot is empty; being superseded says another reveal now owns the
 * viewport, and only that is a reason for a reveal in flight to stop trying. The
 * two are tracked separately because a reveal outlives the pin it lost.
 */
export type RevealBlock = 'nearest' | 'center';

export interface RevealTarget {
	/** The full path the reveal was asked for, not a top-level narrowing. */
	path: number[];
	block: RevealBlock;
}

/** One `scrollTo`'s hold on the slot. */
export interface RevealClaim {
	/** Drop the pin, iff this claim still holds it. A superseded claimant's
	 *  terminal release is a no-op. */
	release(): void;
	/**
	 * True once a LATER claim was minted — whether or not that successor still holds
	 * the slot, and whether or not this claim did when it was displaced. Distinct
	 * from the user releasing the pin and from this claim releasing itself, both of
	 * which leave the slot empty without appointing a successor. Only a successor
	 * means "someone else owns the viewport now"; a user release means the reader
	 * took over, which is not a reason for a reveal in flight to abandon what it was
	 * asked to do.
	 */
	isSuperseded(): boolean;
}

export interface RevealAnchorState {
	/** The active reveal target, or null when no reveal is in flight. */
	get(): RevealTarget | null;
	/** Take the slot, superseding whoever held it. */
	claim(path: readonly number[], block?: RevealBlock): RevealClaim;
	/** Drop the pin whoever holds it — the user-intent release. */
	releaseAll(): void;
}

export function createRevealAnchorState(): RevealAnchorState {
	// Identity, not the path: two claimants can reveal the same target, and only
	// the one that still holds the slot may release it. The flag rides the token so
	// "a successor took the slot" stays distinguishable from "the slot is empty"
	// even after that successor releases in turn.
	type ClaimToken = { superseded: boolean };

	let target: RevealTarget | null = null;
	// Who holds the pin, and who claimed last. They diverge whenever the slot empties
	// while a reveal is still running — a pointerdown releasing the pin does not end
	// the reveal it interrupted — and supersession is a fact about REVEALS, so it is
	// the last mint that a new claim supersedes, not the current holder. Reading the
	// holder would let `claim → release → claim` leave the first reveal believing it
	// still owns the viewport, and two settle loops would scroll against each other.
	let owner: ClaimToken | null = null;
	let lastMinted: ClaimToken | null = null;

	function drop(): void {
		owner = null;
		target = null;
	}

	return {
		get: () => target,
		claim(path, block = 'nearest') {
			const token: ClaimToken = { superseded: false };
			if (lastMinted) lastMinted.superseded = true;
			lastMinted = token;
			owner = token;
			target = { path: [...path], block };
			return {
				release: () => {
					if (owner === token) drop();
				},
				isSuperseded: () => token.superseded
			};
		},
		releaseAll: drop
	};
}
