/**
 * Merge eligibility rules for the block editor.
 * Determines what happens on Backspace at the start of a block.
 * See docs/design/editor/editor.md — Structural Operations, Merge Eligibility.
 */

import type { BlockKind } from './core/nodes';

// ── Merge Roles ─────────────────────────────────────────────────────────────

/**
 * A block's merge role classifies its behavior for Backspace-merge purposes.
 *
 *   prose           — leaf text block that can merge with or absorb other prose
 *   prose-absorber  — prose leaf that retains its kind when absorbing prose
 *                     (e.g. heading stays a heading)
 *   container       — block whose merge target is its deepest reachable prose leaf
 *   self-merge      — merges only with another block of the same role
 *   opaque          — not mergeable; Backspace either deletes (if non-editable)
 *                     or moves focus
 *
 * `listItem` is assigned `container` for walker correctness — the walker
 * descends through list items, and the recursion relies on each descent step
 * returning `container`. `listItem` is never seen as a top-level `prev` block
 * by `Editor.mergeWithPrevious`, so the eligibility check `isMergeEligible
 * ('listItem', ...)` is never reached in production.
 */
export type MergeRole =
	| 'prose'
	| 'prose-absorber'
	| 'container'
	| 'self-merge'
	| 'opaque';

export const MERGE_ROLE: Record<BlockKind, MergeRole> = {
	paragraph: 'prose',
	heading: 'prose-absorber',
	setextHeading: 'prose-absorber',
	fencedCode: 'opaque',
	thematicBreak: 'opaque',
	indentedCode: 'opaque',
	htmlBlock: 'opaque',
	linkReferenceDefinition: 'opaque',
	table: 'opaque',
	unrecognized: 'self-merge',
	blockquote: 'container',
	list: 'container',
	listItem: 'container'
};

// ── Merge Eligibility ───────────────────────────────────────────────────────

/**
 * Can the block at `currKind` merge into the block at `prevKind` on Backspace?
 * When false, Backspace either deletes the previous block (if non-editable)
 * or moves focus to the end of the previous block (if editable).
 *
 * Eligibility is derived from role pairs, not an enumerated pair set:
 *   prose           + prose          → eligible (concat text)
 *   prose-absorber  + prose          → eligible (prev stays its kind)
 *   self-merge      + self-merge     → eligible
 *   anything else                    → not eligible
 *
 * Note: `container + prose` is intentionally not enabled here yet — that
 * cross-container merge path is wired in a later task once the walker
 * helpers (walkToDeepestMergeLeaf, findMergeTarget) are in place.
 */
export function isMergeEligible(prevKind: BlockKind, currKind: BlockKind): boolean {
	const prev = MERGE_ROLE[prevKind];
	const curr = MERGE_ROLE[currKind];

	if (prev === 'prose' && curr === 'prose') return true;
	if (prev === 'prose-absorber' && curr === 'prose') return true;
	if (prev === 'self-merge' && curr === 'self-merge') return true;

	return false;
}

// ── Block Editability ───────────────────────────────────────────────────────

const NON_EDITABLE_KINDS = new Set<BlockKind>(['thematicBreak']);

/**
 * Can this block receive text input? Non-editable blocks (thematic break)
 * are deleted on Backspace from the following block.
 */
export function isBlockEditable(kind: BlockKind): boolean {
	return !NON_EDITABLE_KINDS.has(kind);
}
