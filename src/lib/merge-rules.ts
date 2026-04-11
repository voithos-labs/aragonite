/**
 * Merge eligibility rules for the block editor.
 * Determines what happens on Backspace at the start of a block.
 * See docs/editor/design/editor.md — Structural Operations, Merge Eligibility.
 */

// ── Merge Eligibility ───────────────────────────────────────────────────────

const MERGEABLE_PAIRS = new Set([
	'paragraph+paragraph',
	'heading+paragraph',
	'setextHeading+paragraph',
	'unrecognized+unrecognized'
]);

/**
 * Can the block at `currKind` merge into the block at `prevKind` on Backspace?
 * When false, Backspace either deletes the previous block (if non-editable)
 * or moves focus to the end of the previous block (if editable).
 */
export function isMergeEligible(prevKind: string, currKind: string): boolean {
	return MERGEABLE_PAIRS.has(`${prevKind}+${currKind}`);
}

// ── Block Editability ───────────────────────────────────────────────────────

const NON_EDITABLE_KINDS = new Set(['thematicBreak']);

/**
 * Can this block receive text input? Non-editable blocks (thematic break)
 * are deleted on Backspace from the following block.
 */
export function isBlockEditable(kind: string): boolean {
	return !NON_EDITABLE_KINDS.has(kind);
}
