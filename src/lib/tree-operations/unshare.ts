/**
 * Copy-path-on-write for structural-sharing undo. Before any in-place write,
 * the spine from the document root to the write target must be unshared —
 * shared nodes are still referenced by undo/redo entries, and writing through
 * them corrupts history. Copies are SHALLOW: children/childIds arrays are
 * fresh, but child refs still point at shared subtrees (unshare deeper only
 * where you write).
 *
 * Write-then-re-read: after assigning a copy (node or children array) into the
 * live tree, RE-READ it through the tree before any further use. A live $state
 * tree wraps stored values in proxies, and later writes must go through the
 * canonical wrapper or proxy readers see a stale view.
 *
 * Any layer that knows a path may call in; tree-operations ops own their own
 * spine rather than assuming an upstream unshare.
 *
 * This seam is the ONE sanctioned view→mutable door (core/node-views.ts):
 * inputs accept readonly views, returns are owned mutable nodes — the runtime
 * unshare is precisely what makes the byte write legal. The casts below are
 * that door; nowhere outside this seam and the commit ceremony may strip a
 * view back to `CstNode`.
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
	// The door: the copy is freshly owned; its children still alias shared
	// subtrees, which the shallow-unshare contract already states.
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
 * The copy-on-write spine walk shared by `ensureUnsharedPath` and
 * `rebuildUnsharedAncestry`: descend `path` from `root`, copying every
 * still-shared node into its (already-unshared) parent, and return the owned
 * chain outermost-first. `assertInRange` is the only difference between the two
 * callers — it fires G1.22 on an index that ran off a live child (the strict
 * unshare path) or stays silent (tolerant rebuild passes hand short paths). The
 * walk stops at the first gap either way.
 */
function walkUnsharing(
	root: NodeParentView,
	path: number[],
	sharing: SharingState,
	assertInRange: boolean
): CstNode[] {
	const chain: CstNode[] = [];
	// The door (file header): the root is the live document or a ceremony-owned
	// array, so its children array is writable by contract.
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
 * Unshare every node along `path` (child indices from `root`), splicing
 * copies into their (already-unshared) parents. Returns the node chain,
 * outermost first. `root` is the live document for out-of-ceremony writes
 * (routine typing) or a `{ children }` view over a commit ceremony's array
 * copy — either way the caller owns the array, so the splice is safe.
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
	// G1.22, the same gate the spine walk carries: an index off the end is a caller
	// bug either way, but reading `ownerEpoch` off the gap made it epoch-dependent —
	// silent before the first snapshot, a TypeError inside `isShared` after one.
	assertInvariant('unshare-path-in-range', () =>
		child ? null : { code: 'unshare-path', message: `child index ${index} out of range` }
	);
	if (!child || !sharing.isShared(child)) return child;
	parent.children![index] = copyNode(child, sharing);
	// Write-then-re-read (file header).
	return parent.children![index];
}

/**
 * Standalone copy for a node being MOVED out of a parent the snapshot keeps
 * (the caller attaches the returned copy; the original stays in the old
 * parent's shared children array untouched). An unshared input passes through
 * as-is — the door (file header): unshared means live-tree-owned, so the
 * mutable return is what the runtime check just proved.
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
 * Rebuild one owned container's raw. A grid rebuild rewrites its children's raw
 * (the table's canonical padding), so a grid's children are unshared first — read
 * off the container contract, not a `table` kind test, or a plugin grid writes
 * through shared children. Over-broad by one level (a row's rebuild only reads its
 * cells), which is the safe direction: an unnecessary copy is correct, a missed one
 * corrupts history.
 */
export function rebuildOwnedContainer(node: CstNode, sharing: SharingState): void {
	if (getBlockKindDescriptor(node.kind).containerContract === 'grid') {
		ensureUnsharedChildren(node, sharing);
	}
	rebuildContainerRawIfContainer(node);
}

/**
 * Longest prefix of `chain` still attached under `root`, identity-checked level
 * by level. A commit mutation may splice one scope's node out of the tree (an
 * emptied nested list, a consumed range endpoint); rebuilding the detached
 * node's raw against its emptied children writes `raw: ''` and the commit-time
 * staleness check then fires on a node the document no longer contains.
 * Ancestors above the detachment point still need their rebuild — hence prefix,
 * not all-or-nothing. A node MOVED to a new parent counts as detached from this
 * chain: the mover owns its rebuild, and its new spine is the mover's chain.
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
 * One container slot a rebuild re-kinded. `previous` is the register that puts the
 * slot back: a commit that unwinds after the swap has already published the
 * replacement into a live children array, which no other rollback register reaches.
 */
export interface ContainerReclassification {
	siblings: CstNode[];
	index: number;
	previous: CstNode;
	replacement: CstNode;
}

/**
 * Rebuild raws along an owned spine chain (as returned by ensureUnsharedPath),
 * innermost-first, re-deriving each container's kind from its fresh raw.
 * Returns the slots a re-derivation re-kinded (empty on the routine path).
 *
 * Chain-based rather than path-based so it stays correct after mutations shifted
 * sibling indices — node references survive splices; `root` supplies the
 * outermost level's parent, and a replaced node's slot is found by identity.
 * One chain rebuild = one rebuild-depth histogram sample.
 *
 * The kind re-derivation costs a parse of the container's WHOLE raw, so it is
 * gated twice. An opener claims from line 1, so a body-line edit cannot change
 * what the container opens as — that is a string compare. And an edit that DOES
 * rewrite line 1 still only matters when it moved the line's opener verdict
 * (`lineOpensAs`, a one-line parse): typing into a list's first item or a callout
 * title rewrites the opener line on every keystroke and moves nothing. Without the
 * second gate the parse is linear in container bytes on a gesture that is not,
 * which is a keystroke cost on the container-size axis.
 */
export function rebuildUnsharedChain(
	root: NodeParent | CstNode,
	chain: CstNode[],
	sharing: SharingState,
	grammar?: GrammarView
): ContainerReclassification[] {
	const reclassified: ContainerReclassification[] = [];
	for (let i = chain.length - 1; i >= 0; i--) {
		const node = chain[i];
		const openerLineBefore = firstLine(node.raw);
		rebuildOwnedContainer(node, sharing);
		const openerLineAfter = firstLine(node.raw);
		if (openerLineAfter === openerLineBefore) continue;
		if (lineOpensAs(openerLineAfter, grammar) === lineOpensAs(openerLineBefore, grammar)) continue;

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

/** The container's opener line — everything before its first line ending. */
function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/**
 * Unshare the spine to `path` and rebuild the node at `path` (when it is a
 * container) plus every ancestor, innermost-first. Tolerates paths that ran
 * out of range mid-walk (post-delete rebuild passes). Use only when `path` is
 * still valid for the ancestors that matter; prefer rebuildUnsharedChain over
 * a chain captured at unshare time when indices may have shifted.
 */
export function rebuildUnsharedAncestry(
	root: NodeParent,
	path: number[],
	sharing: SharingState,
	grammar?: GrammarView
): ContainerReclassification[] {
	return rebuildUnsharedChain(root, walkUnsharing(root, path, sharing, false), sharing, grammar);
}
