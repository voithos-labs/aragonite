/**
 * Merge eligibility and target resolution for Backspace-at-start — the role-pair rules and the
 * target-finding walker; per-kind `MergeRole` assignment lives on `BlockKindDescriptor`.
 * See docs/design/editor.md — Merge eligibility: roles, not pairs.
 */

import type { CstNode } from '../core/nodes';
import { getBlockKindDescriptor, type MergeRole } from './block-kind-descriptor';
import { isCollapsedContainer } from './reserved-chrome';

// ── Merge Eligibility ───────────────────────────────────────────────────────

/** Can `currKind` merge into `prevKind` on Backspace? Derived from role pairs, never kinds. */
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
 * `target` is the leaf whose `raw` receives the merged text; `path` walks from the caller's
 * `prev` block down to it, and is empty when `target === prev`.
 */
export interface MergeTarget {
	target: CstNode;
	path: number[];
}

/**
 * Descend into the last child until landing on a prose / prose-absorber leaf; null on a
 * not-mergeable leaf or an empty container. A collapsed container clamps its body out of view,
 * so the walk descends to the chrome leaf (child 0) instead — its not-mergeable role turns the
 * merge into the caller's focus-move fallback rather than a hidden-body write.
 */
export function walkToDeepestMergeLeaf(node: CstNode, path: number[]): MergeTarget | null {
	const role = getMergeRole(node.kind);
	if (role === 'prose' || role === 'prose-absorber') {
		return { target: node, path };
	}
	if (!node.children || node.children.length === 0) {
		return null;
	}
	const nextIndex = isCollapsedContainer(node) ? 0 : node.children.length - 1;
	return walkToDeepestMergeLeaf(node.children[nextIndex], [...path, nextIndex]);
}

/** The leaf that receives text merged into `prev`; null means the caller moves focus instead. */
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
