/**
 * Merge eligibility and target resolution for Backspace-at-start.
 * See docs/design/editor/editor.md — Structural Operations.
 *
 * Per-kind `MergeRole` assignment lives on `BlockKindDescriptor`; this file
 * owns the role-pair eligibility rules and the target-finding walker.
 */

import type { CstNode } from '../core/nodes';
import { getBlockKindDescriptor, type MergeRole } from './block-kind-descriptor';

// ── Merge Eligibility ───────────────────────────────────────────────────────

/**
 * Can `currKind` merge into `prevKind` on Backspace? Eligibility is derived
 * from role pairs:
 *   prose / prose-absorber / container + prose → eligible
 *   self-merge + self-merge                    → eligible
 *   anything else                              → not eligible
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
 * `target` is the leaf whose `raw` receives the merged text. `path` walks
 * from the caller's `prev` block down to `target`; empty path means
 * `target === prev` (prev was itself a prose leaf).
 */
export interface MergeTarget {
	target: CstNode;
	path: number[];
}

/**
 * Descend `node` into its last child at every step until landing on a prose
 * / prose-absorber leaf, or returning null on an opaque leaf / empty container.
 * Uniform last-child descent works because blockquote, list, and list-item
 * children all place the visually-last element at children[length-1].
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
 * Find the leaf that should receive text merged into `prev`:
 *   prose / prose-absorber / self-merge → prev itself (empty path)
 *   container                           → deepest prose leaf in the subtree
 *   opaque                              → null (caller falls back to move-focus)
 */
export function findMergeTarget(prev: CstNode): MergeTarget | null {
	const role = getMergeRole(prev.kind);
	if (role === 'prose' || role === 'prose-absorber' || role === 'self-merge') {
		return { target: prev, path: [] };
	}
	if (role === 'container') {
		return walkToDeepestMergeLeaf(prev, []);
	}
	return null;
}

// ── Block Editability ───────────────────────────────────────────────────────

export function isBlockEditable(kind: CstNode['kind']): boolean {
	return getBlockKindDescriptor(kind).editable;
}
