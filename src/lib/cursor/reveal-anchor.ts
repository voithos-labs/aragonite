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
	/** False once a later claim took the slot, or the user released it. */
	isCurrent(): boolean;
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
	let target: RevealTarget | null = null;
	// Identity, not the path: two claimants can reveal the same target, and only
	// the one that still holds the slot may release it.
	let owner: symbol | null = null;

	function drop(): void {
		owner = null;
		target = null;
	}

	return {
		get: () => target,
		claim(path, block = 'nearest') {
			const token = Symbol('reveal-claim');
			owner = token;
			target = { path: [...path], block };
			return {
				release: () => {
					if (owner === token) drop();
				},
				isCurrent: () => owner === token
			};
		},
		releaseAll: drop
	};
}
