/**
 * The block a scroll-into-view holds in place. While one is in progress, the root block list's
 * `correctAnchor` keeps the target at its requested `block` placement on screen instead of holding
 * the block at the top of the viewport, so image decodes above it cannot shrink the document and
 * clamp the scroll off it. One slot, owned by the latest claim; a plain closed-over value, never
 * reactive `$state`.
 */
export type RevealBlock = 'nearest' | 'center';

export interface RevealTarget {
	/** The full path the reveal was asked for, not a top-level narrowing. */
	path: number[];
	block: RevealBlock;
}

/** One `scrollTo`'s hold on the slot. */
export interface RevealClaim {
	/** Drop the held block, but only if this claim still holds it; a superseded claim's release
	 *  does nothing. */
	release(): void;
	/** True once a later claim was made, the only signal that another scroll-into-view owns the
	 *  viewport. An empty slot (released by the user or by this claim) is not one, and is no
	 *  reason for a scroll in progress to abandon what it was asked to do. */
	isSuperseded(): boolean;
}

export interface RevealAnchorState {
	get(): RevealTarget | null;
	/** Take the slot, superseding whoever held it. */
	claim(path: readonly number[], block?: RevealBlock): RevealClaim;
	/** Drop the held block whoever holds it: the release for a user scroll. */
	releaseAll(): void;
}

export function createRevealAnchorState(): RevealAnchorState {
	// Identity, not the path: two claimants can reveal the same target, and only the one
	// still holding the slot may release it.
	type ClaimToken = { superseded: boolean };

	let target: RevealTarget | null = null;
	// A new claim supersedes the last claim made, not the current holder: reading the holder
	// would let `claim, release, claim` leave the first scroll-into-view believing it still owns
	// the viewport (two correction loops writing one scrollTop).
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
