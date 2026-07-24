/**
 * Reveal-target anchor. While a programmatic reveal is active, the top-level
 * windowing scope's `correctAnchor` holds the reveal target's screen position
 * instead of the top-of-viewport block — so async image-decode churn above the
 * target can't shrink the document and clamp the scroll off it. Mirrors the
 * sticky-column state shape (`cursor/sticky-column.ts`); plain closed-over value,
 * read imperatively by `correctAnchor`, never reactive `$state`.
 *
 * The target carries its `block` placement so `correctAnchor` re-asserts the
 * position the reveal asked for: `'nearest'` top-pins the target (search's band,
 * and `scrollTo`'s default); `'center'` re-centers it every measure pass, so a
 * `{ block: 'center' }` scroll survives the same shrink a top-pin does.
 *
 * Set when a reveal begins; cleared on the next user-intent event (keydown /
 * pointerdown / wheel in the document) so normal-scroll anchoring is untouched —
 * NOT on `scroll`, which a programmatic `correctAnchor` write itself fires.
 */
export type RevealBlock = 'nearest' | 'center';

export interface RevealTarget {
	path: number[];
	block: RevealBlock;
}

export interface RevealAnchorState {
	/** The active reveal target, or null when no reveal is in flight. */
	get(): RevealTarget | null;
	set(path: number[], block?: RevealBlock): void;
	clear(): void;
}

export function createRevealAnchorState(): RevealAnchorState {
	let target: RevealTarget | null = null;
	return {
		get: () => target,
		set: (path, block = 'nearest') => {
			target = { path, block };
		},
		clear: () => {
			target = null;
		}
	};
}
