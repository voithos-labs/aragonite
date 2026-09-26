/**
 * Edge affinity: which of the two raw offsets a caret means when it sits beside a hidden
 * marker run, whose interior paints nothing so both offsets land on one pixel. The caret memory
 * (`cursor/caret-memory.ts`) holds the answer; this module decides it from the key.
 */

import { BARE_MODIFIER_KEYS, isCharacterKey } from '../schema/keybindings';

/**
 * Which raw offset a hidden run's one pixel names. Two answers are positional, the run's `near`
 * (earlier) or `far` (later) side in walk order, and one is relative to the construct: `outside`
 * means past the construct's delimiters whichever side that is, so it reads as the run's start
 * at an opener and its end at a closer.
 */
export type EdgeAffinity = 'near' | 'far' | 'outside';

/** What a keydown does to the affinity. */
export type EdgeAffinityAction = EdgeAffinity | 'preserve' | 'reset';

/** Pure on the key, so the matrix is testable without a DOM or a memory instance. */
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
