/**
 * Copy-path-on-write for structural-sharing undo: unshare the root→target spine before
 * any in-place write — undo entries still reference shared nodes. Copies are SHALLOW, so
 * unshare deeper wherever you write. Write-then-re-read: after assigning a copy into the
 * live tree, re-read it through the tree — the `$state` proxy wrapper is canonical, not
 * the copy you held. Also the one sanctioned view→mutable door (`core/node-views.ts`).
 */
import type { CstNode } from '../core/nodes';
import type { NodeParentView, NodeView } from '../core/node-views';
import type { SharingState } from './sharing';
import type { NodeParent } from './node-ops';
import { assertInvariant } from '../invariants/assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { GrammarView } from '../schema/block-openers';
import { perfEnabled, recordRebuildDepth } from '../perf/instruments';
import { cloneMetadata } from './clone';
import { lineOpensAs, reclassifyContainer } from './node-ops';

function copyNode(node: NodeView, sharing: SharingState): CstNode {
	const copy = { ...node } as CstNode;
	if (node.children) copy.children = [...node.children] as CstNode[];
	if (node.childIds) copy.childIds = [...node.childIds];
	if (node.metadata) {
		assertInvariant('clone-safe-metadata', () => checkCloneSafeMetadata(node));
		copy.metadata = cloneMetadata(node.metadata);
	}
	sharing.stamp(copy);
	return copy;
}

/**
 * The copy-on-write spine walk, returning the owned chain outermost-first.
 * `assertInRange` fires G1.22 for the strict `ensureUnsharedPath` caller and stays
 * silent for tolerant rebuild passes, which legitimately hand short paths; the walk
 * stops at the first gap either way.
 */
function walkUnsharing(
	root: NodeParentView,
	path: number[],
	sharing: SharingState,
	assertInRange: boolean
): CstNode[] {
	const chain: CstNode[] = [];
	// Root is the live document or a ceremony-owned array — writable by contract (file header).
	let parentChildren = root.children as CstNode[];
	for (const index of path) {
		let node = parentChildren[index];
		if (assertInRange) {
			assertInvariant('unshare-path-in-range', () =>
				node ? null : { code: 'unshare-path', message: `path index ${index} out of range` }
			);
		}
		if (!node) break;
		if (sharing.isShared(node)) {
			parentChildren[index] = copyNode(node, sharing);
			// Write-then-re-read (file header).
			node = parentChildren[index];
		}
		chain.push(node);
		parentChildren = node.children ?? [];
	}
	return chain;
}

/**
 * Unshare every node along `path` from `root`; returns the chain outermost-first.
 * The caller owns `root.children` (live document, or a commit ceremony's array copy),
 * which is what makes the splice safe.
 */
export function ensureUnsharedPath(
	root: NodeParentView,
	path: number[],
	sharing: SharingState
): CstNode[] {
	return walkUnsharing(root, path, sharing, true);
}

/**
 * Unshare one direct child of an already-unshared parent — a node, or a
 * caller-owned `{ children }` view (e.g. a commit ceremony's array copy).
 */
export function ensureUnsharedChild(
	parent: CstNode | NodeParent,
	index: number,
	sharing: SharingState
): CstNode {
	const child = parent.children![index];
	// G1.22 — an index off the end is a caller bug; fail here rather than
	// epoch-dependently inside `isShared`.
	assertInvariant('unshare-path-in-range', () =>
		child ? null : { code: 'unshare-path', message: `child index ${index} out of range` }
	);
	if (!child || !sharing.isShared(child)) return child;
	parent.children![index] = copyNode(child, sharing);
	// Write-then-re-read (file header).
	return parent.children![index];
}

/**
 * Standalone copy for a node being MOVED out of a parent the snapshot keeps: the caller
 * attaches the returned copy, the original stays in the old parent untouched. An
 * unshared input passes through — unshared already means live-tree-owned.
 */
export function ensureUnsharedNode(node: NodeView, sharing: SharingState): CstNode {
	return sharing.isShared(node) ? copyNode(node, sharing) : (node as CstNode);
}

/** Unshare every direct child of an owned parent (e.g. table rows before a whole-table rebuild). */
export function ensureUnsharedChildren(parent: CstNode, sharing: SharingState): void {
	const count = parent.children?.length ?? 0;
	for (let i = 0; i < count; i++) ensureUnsharedChild(parent, i, sharing);
}

/**
 * Deep-unshare an owned node's subtree. Intended for small bounded subtrees
 * (tables: rows + cells) ahead of ops that write at arbitrary depth.
 */
export function ensureUnsharedSubtree(node: CstNode, sharing: SharingState): void {
	const count = node.children?.length ?? 0;
	for (let i = 0; i < count; i++) {
		ensureUnsharedSubtree(ensureUnsharedChild(node, i, sharing), sharing);
	}
}

// ── Sharing-aware raw rebuilds ───────────────────────────────────────────────

/**
 * Rebuild one owned container's raw. A grid rebuild rewrites its children's raw, so a
 * grid's children are unshared first — keyed off `containerContract`, not a `table` kind
 * test, or a plugin grid writes through shared children.
 */
export function rebuildOwnedContainer(node: CstNode, sharing: SharingState): void {
	if (getBlockKindDescriptor(node.kind).containerContract === 'grid') {
		ensureUnsharedChildren(node, sharing);
	}
	rebuildContainerRawIfContainer(node);
}

/**
 * Longest prefix of `chain` still attached under `root`, identity-checked level by level.
 * A commit mutation can splice a node out mid-ceremony; rebuilding the detached node's
 * raw against its emptied children writes `raw: ''` and trips the commit-time staleness
 * check. Ancestors above the detachment still need their rebuild — hence prefix.
 */
export function attachedChainPrefix(root: NodeParent, chain: CstNode[]): CstNode[] {
	let parentChildren = root.children;
	for (let i = 0; i < chain.length; i++) {
		if (!parentChildren.includes(chain[i])) return chain.slice(0, i);
		parentChildren = chain[i].children ?? [];
	}
	return chain;
}

/**
 * One container slot a rebuild re-kinded. `previous` is the rollback register: a commit
 * unwinding after the swap has already published `replacement` into a live children
 * array, which no other rollback register reaches.
 */
export interface ContainerReclassification {
	siblings: CstNode[];
	index: number;
	previous: CstNode;
	replacement: CstNode;
}

/**
 * Rebuild raws along an owned spine chain innermost-first, re-deriving each container's
 * kind; chain- rather than path-based so it survives sibling-index shifts. Re-derivation
 * costs a whole-container parse, so it is gated on the opener line changing AND
 * `lineOpensAs` no longer naming the current kind — a positive identification, so a
 * declining opener parses rather than eliding a real kind change
 * (`test/tree-operations/opener-verdict-agreement`).
 */
export function rebuildUnsharedChain(
	root: NodeParent | CstNode,
	chain: CstNode[],
	sharing: SharingState,
	grammar: GrammarView | undefined
): ContainerReclassification[] {
	const reclassified: ContainerReclassification[] = [];
	for (let i = chain.length - 1; i >= 0; i--) {
		const node = chain[i];
		const openerLineBefore = firstLine(node.raw);
		rebuildOwnedContainer(node, sharing);
		const openerLineAfter = firstLine(node.raw);
		if (openerLineAfter === openerLineBefore) continue;
		if (lineOpensAs(openerLineAfter, grammar) === node.kind) continue;

		const siblings = (i === 0 ? root : chain[i - 1]).children;
		const index = siblings?.indexOf(node) ?? -1;
		if (!siblings || index < 0) continue;
		const replacement = reclassifyContainer({ children: siblings }, index, grammar);
		if (replacement) {
			sharing.stamp(replacement);
			reclassified.push({ siblings, index, previous: node, replacement });
		}
	}
	if (perfEnabled()) recordRebuildDepth(chain.length);
	return reclassified;
}

/** The container's opener line. */
function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/**
 * Unshare the spine to `path` and rebuild it innermost-first, tolerating paths that ran
 * out of range mid-walk (post-delete rebuild passes). Prefer `rebuildUnsharedChain` when
 * indices may have shifted since the unshare.
 */
export function rebuildUnsharedAncestry(
	root: NodeParent,
	path: number[],
	sharing: SharingState,
	grammar: GrammarView | undefined
): ContainerReclassification[] {
	return rebuildUnsharedChain(root, walkUnsharing(root, path, sharing, false), sharing, grammar);
}
