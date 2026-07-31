/**
 * Reveal-target anchor. While a reveal is in flight the top-level windowing scope's
 * `correctAnchor` re-asserts the target's screen position at its requested `block`
 * placement instead of anchoring the top-of-viewport block, so image-decode churn
 * above it can't shrink the document and clamp the scroll off it. One slot with
 * per-call ownership; a plain closed-over value, never reactive `$state`.
 */
export type RevealBlock = 'nearest' | 'center';

export interface RevealTarget {
	/** The full path the reveal was asked for, not a top-level narrowing. */
	path: number[];
	block: RevealBlock;
}

/** One `scrollTo`'s hold on the slot. */
export interface RevealClaim {
	/** Drop the pin, iff this claim still holds it — a superseded claimant's release is a no-op. */
	release(): void;
	/** True once a LATER claim was minted — the only signal that another reveal owns the
	 *  viewport. An empty slot (a user or self release) is not one, and is no reason for a
	 *  reveal in flight to abandon what it was asked to do. */
	isSuperseded(): boolean;
}

export interface RevealAnchorState {
	get(): RevealTarget | null;
	/** Take the slot, superseding whoever held it. */
	claim(path: readonly number[], block?: RevealBlock): RevealClaim;
	/** Drop the pin whoever holds it — the user-intent release. */
	releaseAll(): void;
}

export function createRevealAnchorState(): RevealAnchorState {
	// Identity, not the path: two claimants can reveal the same target, and only the one
	// still holding the slot may release it.
	type ClaimToken = { superseded: boolean };

	let target: RevealTarget | null = null;
	// A new claim supersedes the last MINT, not the current holder: supersession is a fact
	// about reveals, and reading the holder would let `claim → release → claim` leave the
	// first reveal believing it still owns the viewport (two settle loops, one scrollTop).
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
