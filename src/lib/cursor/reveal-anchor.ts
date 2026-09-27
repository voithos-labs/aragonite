/**
 * The block a scroll into view holds in place: while one is in progress, the root list's
 * `correctAnchor` keeps that block at its requested placement, so image decodes above it cannot
 * clamp the scroll off it. One slot, owned by the latest claim; a plain value, not `$state`.
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
	/** True once a later claim was made, the only sign another scroll-into-view owns the viewport.
	 *  An empty slot is no reason for a scroll in progress to abandon its target. */
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
	// A new claim supersedes the last claim made, not the current holder, or `claim, release, claim`
	// would leave the first scroll-into-view believing it still owns the viewport.
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
