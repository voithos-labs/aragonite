/**
 * Edge affinity: which of the two raw offsets a caret means when it sits beside a hidden
 * marker run, whose interior paints nothing so both offsets land on one pixel. The shared
 * keydown handler records the key that put the caret there through `note`; the typing path
 * reads `get()` and keeps its own default when the answer is null.
 */

import { BARE_MODIFIER_KEYS, isCharacterKey } from '../schema/keybindings';

/**
 * Which raw offset a hidden run's one pixel names. Two answers are positional, the run's `near`
 * (earlier) or `far` (later) side in walk order, and one is relative to the construct: `outside`
 * means past the construct's delimiters whichever side that is, so it reads as the run's start
 * at an opener and its end at a closer.
 */
export type EdgeAffinity = 'near' | 'far' | 'outside';

export interface EdgeAffinityState {
	get(): EdgeAffinity | null;

	/** The only entry point a keydown handler may use; `reset()` is for callers with no key. */
	note(e: Pick<KeyboardEvent, 'key' | 'altKey'> & Partial<Pick<KeyboardEvent, 'metaKey'>>): void;

	/** A committed keystroke belongs to the content whatever arrival preceded it. */
	noteTyping(): void;

	/**
	 * The caret was placed at an end rather than stepped there (a range collapsing onto its own
	 * edge). The key was directional but the caret took no step, so the side it means is relative
	 * to the construct, the same answer Home and End give.
	 */
	noteExtreme(): void;

	reset(): void;
}

export interface EdgeAffinityDeps {
	/**
	 * Short-lived caret state with this same lifetime (pending marks, `cursor/pending-marks.ts`)
	 * clears on this callback, so every path that sets the affinity clears it too.
	 */
	onInvalidate?: () => void;
}

export function createEdgeAffinityState(deps: EdgeAffinityDeps = {}): EdgeAffinityState {
	let affinity: EdgeAffinity | null = null;

	/** Sets the side and clears everything riding on it in one step, so no caller can do the
	 *  first without the second. */
	function settle(next: EdgeAffinity | null): void {
		affinity = next;
		deps.onInvalidate?.();
	}

	return {
		get: () => affinity,
		noteTyping: () => settle('near'),
		noteExtreme: () => settle('outside'),
		reset: () => settle(null),
		note: (e) => {
			// Alt+Arrow is the block-reorder chord, not caret nav.
			if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
			const action = classifyArrivalKey(e.key, e.metaKey);
			// A preserved key left the caret where it was: the key combination that queues a pending
			// mark and the character that uses it both preserve, so neither may clear the state.
			if (action === 'preserve') return;
			settle(action === 'reset' ? null : action);
		}
	};
}

/** What a keydown does to the affinity. */
export type EdgeAffinityAction = EdgeAffinity | 'preserve' | 'reset';

/** The decision {@link EdgeAffinityState.note} enacts. Pure on the key, so the matrix is
 *  testable without a DOM or a state instance. */
export function classifyArrivalKey(key: string, metaKey = false): EdgeAffinityAction {
	// macOS Cmd+Arrow jumps to the line's end, a placement rather than a step, so it takes
	// Home/End's answer. Windows and Linux never deliver meta+arrow to the page.
	if (metaKey && (key === 'ArrowLeft' || key === 'ArrowRight')) return 'outside';
	// A step stops on the side of the run it came from, so one keypress never changes which
	// construct the caret is in (live-mode.md § 4.2); leaving a construct is a typed closer's job
	// (delimiter-autopair.ts) or a toggle's, not the arrow's.
	if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown') return 'near';
	if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'far';
	// Home and End are relative to the construct, not directional: `Home` before a construct
	// that starts the line means before its opener, the run's earlier side, which is the
	// opposite answer from `End` after a construct that ends the line.
	if (key === 'Home' || key === 'End') return 'outside';
	// Bare modifiers come from the key-combination parser rather than a local list, which could
	// miss AltGraph and drop the side on a modifier tap mid-arrow-run. A printable key preserves
	// because the typing path reads the side later in this same keydown.
	if (BARE_MODIFIER_KEYS.includes(key) || isCharacterKey(key)) return 'preserve';
	// Anything left moves the caret by a mutation or a command, not by a key; the commit path
	// sets the side again through `noteTyping`.
	return 'reset';
}
