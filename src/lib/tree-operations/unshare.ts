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
import type { NodeParent, TrackedPosition } from './node-ops';
import type { StructuralChange } from './structural-change';
import { assertInvariant } from '../assert';
import { checkCloneSafeMetadata } from '../invariants/node-shape';
import { rebuildContainerRawIfContainer } from '../schema/container-raw';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { GrammarView } from '../schema/block-openers';
import { trimTrailingLineEnding } from '../core/lines';
import { perfEnabled, recordRebuildDepth } from '../perf/instruments';
import { cloneMetadata } from './clone';
import { absorbWindowSeams, lineOpensAs, reclassifyContainer } from './node-ops';
import { settleSublistSeparator } from './list/sublist-separator';

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
 * A fold the rebuilt container's own slot owed: its bytes stopped interrupting a neighbour, so
 * the parent's array reloads as fewer blocks and no scope-local settle reaches that join
 * `before` is the pre-splice array — the rollback register, since the splice lands in
 * an array no commit descriptor covers. `landing` is where the container's first byte ended up.
 */
export interface AncestrySeamFold {
	/** Chain level of the folded container, so a caller composes the owner's path from its own. */
	depth: number;
	siblings: CstNode[];
	/** The chain node owning `siblings`, or null when they are the rebuild root's children. */
	owner: CstNode | null;
	change: StructuralChange;
	before: CstNode[];
	landing: TrackedPosition;
}

/**
 * Rebuild raws along an owned spine chain innermost-first, re-deriving each container's kind and
 * settling the seams at its own slot; chain- rather than path-based so it survives index shifts.
 * Both passes gate on a boundary line of the rebuilt raw moving; the re-derive additionally needs
 * `lineOpensAs` not to name the current kind, a positive identification so a declining opener
 * parses rather than eliding a real kind change. `folds` is required-nullable: a fold splices the
 * PARENT's array, so only a caller that reconciles that scope's ids/refs passes a sink.
 */
export function rebuildUnsharedChain(
	root: NodeParent | CstNode,
	chain: CstNode[],
	sharing: SharingState,
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView | undefined
): ContainerReclassification[] {
	const reclassified: ContainerReclassification[] = [];
	for (let i = chain.length - 1; i >= 0; i--) {
		const node = chain[i];
		const rawBefore = node.raw;
		rebuildOwnedContainer(node, sharing);
		const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
		const closerMoved = lastLine(rawBefore) !== lastLine(node.raw);
		if (!openerMoved && !closerMoved) continue;

		const owner = i === 0 ? null : chain[i - 1];
		const siblings = (owner ?? root).children;
		const index = siblings?.indexOf(node) ?? -1;
		if (!siblings || index < 0) continue;

		if (openerMoved && lineOpensAs(firstLine(node.raw), grammar) !== node.kind) {
			const replacement = reclassifyContainer({ children: siblings }, index, grammar);
			if (replacement) {
				sharing.stamp(replacement);
				reclassified.push({ siblings, index, previous: node, replacement });
			}
		}
		// Ahead of the seam ask, which then reads the settled bytes: a list rebuilt down to an
		// empty marker owes the paragraph above it a separating line.
		if (openerMoved) settleSublistSeparator(siblings, index);
		// After the re-derive: the seam reads whatever occupies the slot now.
		if (folds) {
			settleSlotSeams(
				{ siblings, owner, depth: i, index, openerMoved, closerMoved },
				sharing,
				folds
			);
		}
	}
	if (perfEnabled()) recordRebuildDepth(chain.length);
	return reclassified;
}

/** Where a rebuilt container sits, and which of its joins its new bytes can have moved. */
interface ChainSlot {
	siblings: CstNode[];
	owner: CstNode | null;
	depth: number;
	index: number;
	/** The join ABOVE turns on the opener line, the one BELOW on the closer: each is asked only
	 *  when its own line moved, so a head-child edit never pays the follower-side parse. */
	openerMoved: boolean;
	closerMoved: boolean;
}

/**
 * Ask the joins at a rebuilt container's slot, since its new bytes can stop interrupting a
 * neighbour, which the reload then reads as one block with it. Byte-identical by construction,
 * like every other seam absorb. `absorbWindowSeams` walks `at - 1 … at + added - 1`, so the two
 * arguments below name exactly the sides whose line moved.
 */
function settleSlotSeams(slot: ChainSlot, sharing: SharingState, folds: AncestrySeamFold[]): void {
	const { siblings, index, openerMoved, closerMoved } = slot;
	// The rollback snapshot is captured only once a fold is certain: an eager copy here cost
	// O(children) reactive reads on every keystroke inside a large container.
	let before: CstNode[] | null = null;
	const landing: TrackedPosition = { index, offset: 0 };
	const settled = absorbWindowSeams(
		{ children: siblings },
		openerMoved ? index : index + 1,
		openerMoved && closerMoved ? 1 : 0,
		index,
		{ op: 'noop' },
		sharing,
		landing,
		index,
		() => {
			before ??= siblings.slice();
		}
	);
	if (settled.change.op === 'noop') return;
	folds.push({
		depth: slot.depth,
		siblings,
		owner: slot.owner,
		change: settled.change,
		// A non-noop change means a splice ran, so the capture ran first.
		before: before!,
		landing
	});
}

/** The container's opener line. */
function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/** The container's closing line: its last line carrying bytes, without the ending. */
function lastLine(raw: string): string {
	const body = trimTrailingLineEnding(raw);
	const nl = body.lastIndexOf('\n');
	return nl < 0 ? body : body.slice(nl + 1);
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
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView | undefined
): ContainerReclassification[] {
	const chain = walkUnsharing(root, path, sharing, false);
	return rebuildUnsharedChain(root, chain, sharing, folds, grammar);
}
