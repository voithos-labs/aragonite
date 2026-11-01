/**
 * The gap caret's own unmodified keys: Enter opens a paragraph at the gap, and the rest leave it
 * (Escape backward, or forward from the first gap). `GapCaret.svelte` runs them and
 * `claimsChord` reads them, so the two can't disagree on which keys the gap takes.
 */
export type GapCaretMove = 'open' | 'forward' | 'backward' | 'away';

// Shift+Arrow is the plain arrow here: a single block selected whole is not a representable
// cross-block state (docs/design/selection.md § The gap caret).
export const GAP_CARET_KEYS: ReadonlyMap<string, GapCaretMove> = new Map([
	['Enter', 'open'],
	['ArrowDown', 'forward'],
	['ArrowRight', 'forward'],
	['Delete', 'forward'],
	['ArrowUp', 'backward'],
	['ArrowLeft', 'backward'],
	['Backspace', 'backward'],
	['Escape', 'away']
]);
