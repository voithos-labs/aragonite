/**
 * Merge eligibility rules for the block editor.
 * Determines what happens on Backspace at the start of a block.
 * See docs/design/editor/editor.md — Structural Operations, Merge Eligibility.
 *
 * The per-kind `MergeRole` assignment lives on the `BlockKindDescriptor`
 * registry in `block-kind-descriptor.ts`. This file owns only the eligibility
 * rules (role-pair semantics) and the target-finding walker.
 */

import type { CstNode } from '../core/nodes';
import { getBlockKindDescriptor, type MergeRole } from './block-kind-descriptor';

// ── Merge Eligibility ───────────────────────────────────────────────────────

/**
 * Can the block at `currKind` merge into the block at `prevKind` on Backspace?
 * When false, Backspace either deletes the previous block (if non-editable)
 * or moves focus to the end of the previous block (if editable).
 *
 * Eligibility is derived from role pairs, not an enumerated pair set:
 *   prose           + prose          → eligible (concat text)
 *   prose-absorber  + prose          → eligible (prev stays its kind)
 *   container       + prose          → eligible (merge into deepest prose leaf)
 *   self-merge      + self-merge     → eligible
 *   anything else                    → not eligible
 */
export function isMergeEligible(prevKind: CstNode['kind'], currKind: CstNode['kind']): boolean {
	const prev = getMergeRole(prevKind);
	const curr = getMergeRole(currKind);

	if (prev === 'prose' && curr === 'prose') return true;
	if (prev === 'prose-absorber' && curr === 'prose') return true;
	if (prev === 'container' && curr === 'prose') return true;
	if (prev === 'self-merge' && curr === 'self-merge') return true;

	return false;
}

export function getMergeRole(kind: CstNode['kind']): MergeRole {
	return getBlockKindDescriptor(kind).mergeRole;
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
	const role = getMergeRole(node.kind);
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
 */
export function findMergeTarget(prev: CstNode): MergeTarget | null {
	const role = getMergeRole(prev.kind);
	if (role === 'prose' || role === 'prose-absorber' || role === 'self-merge') {
		return { target: prev, path: [] };
	}
	if (role === 'container') {
		return walkToDeepestMergeLeaf(prev, []);
	}
	return null; // opaque
}

// ── Block Editability ───────────────────────────────────────────────────────

/**
 * Can this block receive text input? Non-editable blocks (thematic break)
 * are deleted on Backspace from the following block.
 */
export function isBlockEditable(kind: CstNode['kind']): boolean {
	return getBlockKindDescriptor(kind).editable;
}
