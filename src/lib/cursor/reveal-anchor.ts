/**
 * Reveal-target anchor. While a programmatic reveal is active, the top-level
 * windowing scope's `correctAnchor` holds the reveal target's screen position
 * instead of the top-of-viewport block — so async image-decode churn above the
 * target can't shrink the document and clamp the scroll off it. Mirrors the
 * sticky-column state shape (`cursor/sticky-column.ts`); plain closed-over value,
 * read imperatively by `correctAnchor`, never reactive `$state`.
 *
 * Set when a reveal begins; cleared on the next user-intent event (keydown /
 * pointerdown / wheel in the document) so normal-scroll anchoring is untouched —
 * NOT on `scroll`, which a programmatic `correctAnchor` write itself fires.
 */
export interface RevealAnchorState {
	/** The active reveal target path, or null when no reveal is in flight. */
	get(): number[] | null;
	set(path: number[]): void;
	clear(): void;
}

export function createRevealAnchorState(): RevealAnchorState {
	let target: number[] | null = null;
	return {
		get: () => target,
		set: (path) => {
			target = path;
		},
		clear: () => {
			target = null;
		}
	};
}
