/**
 * Merge eligibility rules for the block editor.
 * Determines what happens on Backspace at the start of a block.
 * See docs/design/editor/editor.md — Structural Operations, Merge Eligibility.
 */

import type { BlockKind, CstNode } from './core/nodes';

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

// ── Merge Target Resolution ─────────────────────────────────────────────────

/**
 * The result of resolving where a merge should land.
 *
 * `target` is the leaf CstNode whose `raw` will be mutated to receive the
 * merged text. `path` is a sequence of child-array indices walking from the
 * caller's `prev` block down to `target`. An empty path means `target === prev`
 * — no walking was needed because prev was itself a prose leaf.
 */
export interface MergeTarget {
	target: CstNode;
	path: number[];
}

/**
 * Recursive walker: from `node`, descend into the last child at every step
 * until we land on a prose / prose-absorber leaf (return it) or hit an
 * opaque leaf / empty container (return null).
 *
 * `path` accumulates the child indices we descended through. At the top call
 * the caller passes `path = []`.
 *
 * Uniform descent (always `children[last]`) works because blockquote children,
 * list children (list items), and list-item children (inner blocks) all share
 * the convention that the last child is visually last in the source.
 */
export function walkToDeepestMergeLeaf(node: CstNode, path: number[]): MergeTarget | null {
	const role = MERGE_ROLE[node.kind];
	if (role === 'prose' || role === 'prose-absorber') {
		return { target: node, path };
	}
	if (!node.children || node.children.length === 0) {
		return null;
	}
	const lastIndex = node.children.length - 1;
	return walkToDeepestMergeLeaf(node.children[lastIndex], [...path, lastIndex]);
}

/**
 * Given a `prev` block, find the leaf that should receive the merged text
 * from the current block being backspaced.
 *
 * - prose / prose-absorber prev → returns prev itself, empty path
 * - container prev → walks into the subtree to find the deepest prose leaf
 * - self-merge prev → returns prev itself, empty path
 * - opaque prev → returns null (caller falls back to move-focus)
 *
 * NOTE: for `self-merge` prev (currently only `unrecognized` blocks), the
 * caller receives `{ target: prev, path: [] }` and must handle the self-merge
 * splice itself — the existing `isMergeEligible('unrecognized','unrecognized')`
 * rule only fires when both prev and curr are unrecognized, and the correct
 * behavior is raw-text concatenation without inline content re-parsing.
 * This helper returns a target shape for symmetry but does not prescribe
 * how the caller should use it.
 */
export function findMergeTarget(prev: CstNode): MergeTarget | null {
	const role = MERGE_ROLE[prev.kind];
	if (role === 'prose' || role === 'prose-absorber' || role === 'self-merge') {
		return { target: prev, path: [] };
	}
	if (role === 'container') {
		return walkToDeepestMergeLeaf(prev, []);
	}
	return null; // opaque
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
