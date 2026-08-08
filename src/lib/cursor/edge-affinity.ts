/**
 * Edge affinity: which of the two raw offsets a caret means when it sits beside a hidden
 * marker run, whose interior paints nothing so both offsets land on one pixel. CAPTURE: the
 * arrival that put the caret there, via `note` on the shared keydown door. CONSUME: the
 * write seams, which read `get()` and keep their own default when it answers null.
 */

import { BARE_MODIFIER_KEYS } from '../schema/keybindings';

/** The side of an adjacent hidden run the caret means: the content side, or past the run. */
export type EdgeAffinity = 'inside' | 'outside';

export interface EdgeAffinityState {
	get(): EdgeAffinity | null;

	/**
	 * The only door a keydown handler may use; `reset()` stays public for the lifecycle,
	 * commit, undo and pointer callers, whose unconditional clear has no key to classify.
	 */
	note(e: Pick<KeyboardEvent, 'key' | 'altKey'>): void;

	/** A committed keystroke belongs to the content whatever arrival preceded it. */
	noteTyping(): void;

	reset(): void;
}

export function createEdgeAffinityState(): EdgeAffinityState {
	let affinity: EdgeAffinity | null = null;

	const state: EdgeAffinityState = {
		get: () => affinity,
		noteTyping: () => {
			affinity = 'inside';
		},
		reset: () => {
			affinity = null;
		},
		note: (e) => {
			// Alt+Arrow is the block-reorder chord, not caret nav.
			if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
			const action = classifyArrivalKey(e.key);
			if (action === 'preserve') return;
			affinity = action === 'reset' ? null : action;
		}
	};

	return state;
}

/** What a keydown does to the affinity. */
export type EdgeAffinityAction = EdgeAffinity | 'preserve' | 'reset';

/** The decision {@link EdgeAffinityState.note} enacts. Pure on the key, so the matrix is
 *  testable without a DOM or a state instance. */
export function classifyArrivalKey(key: string): EdgeAffinityAction {
	// Stepping and column landings are content navigation: the content side is where they stop.
	if (key === 'ArrowLeft' || key === 'ArrowRight') return 'inside';
	if (key === 'ArrowUp' || key === 'ArrowDown') return 'inside';
	if (key === 'PageUp' || key === 'PageDown') return 'inside';
	// A line extreme means the raw extreme, past every marker in front of it.
	if (key === 'Home' || key === 'End') return 'outside';
	// Bare modifiers are read from the chord parser rather than re-listed — a local copy
	// missing AltGraph is how a modifier tap mid-arrow-run drops the side. A printable key
	// preserves because its write seat reads the side later in this same keydown.
	if (BARE_MODIFIER_KEYS.includes(key) || key.length === 1) return 'preserve';
	// Anything left lands by a mutation or a command, not by an arrival; the commit seams
	// re-arm through `noteTyping`.
	return 'reset';
}
