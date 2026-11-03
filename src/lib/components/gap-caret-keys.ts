/** The keys `GapCaret.svelte`'s keydown switch takes unmodified, for `claimsChord` to read; the
 *  claims-chord parity tables catch the two drifting apart. */
export const GAP_CARET_KEYS: ReadonlySet<string> = new Set([
	'Enter',
	'ArrowDown',
	'ArrowRight',
	'Delete',
	'ArrowUp',
	'ArrowLeft',
	'Backspace',
	'Escape'
]);
