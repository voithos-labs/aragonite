/**
 * Edge affinity: which of the two raw offsets a caret means when it sits beside a hidden
 * marker run, whose interior paints nothing so both offsets land on one pixel. CAPTURE: the
 * arrival that put the caret there, via `note` on the shared keydown door. CONSUME: the
 * typing seat, which reads `get()` and keeps its own default when it answers null.
 */

import { BARE_MODIFIER_KEYS } from '../schema/keybindings';

/**
 * Which raw offset a hidden run's one pixel names. Two answers are positional — the run's
 * `near` (earlier) or `far` (later) walk-order side — and one is construct-relative:
 * `outside` means past the construct's delimiters whichever side that lands on, so it reads
 * as the run's start at an opener and its end at a closer.
 */
export type EdgeAffinity = 'near' | 'far' | 'outside';

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
			affinity = 'near';
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
	// A step stops on the side of the run it approached from, so one press never changes which
	// construct the caret is in: forward keys reach the near side, backward keys the far one.
	if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown') return 'near';
	if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'far';
	// A line extreme is construct-relative, not directional: `Home` before a line-leading
	// construct means before its opener, which is the run's EARLIER side — the opposite
	// walk-order answer from `End` after a line-trailing one.
	if (key === 'Home' || key === 'End') return 'outside';
	// Bare modifiers are read from the chord parser rather than re-listed — a local copy
	// missing AltGraph is how a modifier tap mid-arrow-run drops the side. A printable key
	// preserves because its write seat reads the side later in this same keydown.
	if (BARE_MODIFIER_KEYS.includes(key) || key.length === 1) return 'preserve';
	// Anything left lands by a mutation or a command, not by an arrival; the commit seams
	// re-arm through `noteTyping`.
	return 'reset';
}
