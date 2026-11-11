/**
 * The keystroke that keeps its leaf's kind, written in place through the commit frame: the
 * leaf's new text, its parent body's fix-up and its ancestors' rebuild, with the rollback, the dev
 * checks and the `input` edit a commit gives. Its typing push already made the undo entry.
 */

import type { InPlaceResult, Relanding } from '../../action-contracts';
import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { documentLineEnding } from '../../core/lines';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { assertLeafLineEndingPairsKept, assertWrittenUnshared } from '../../invariants/install';
import { docPathFrom } from '../../core/coordinate-spaces';
import { caretTargetFor } from '../../selection/caret-target';
import type { CaretPosition } from '../../selection/primitives';
import type { DocPath } from '../../core/coordinate-spaces';
import {
	settledCaretPosition,
	updateNodeContent,
	type LegalWrite,
	type FixedUpWrite
} from '../../tree-operations/content-write';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { documentBody, type BodyParent } from '../../tree-operations/node-primitives';
import { rawOffsetOfLeaf } from '../../tree-operations/container-offsets';
import { keepOneBlock, keepOpenTail } from '../../tree-operations/fix-up/apply';
import { spliceMany } from '../../tree-operations/splice-many';
import {
	rebuildUnsharedChain,
	type AncestrySeamFold,
	type ContainerReclassification
} from '../../tree-operations/chain-rebuild';
import { attachedChainPrefix, blockNodeAt } from '../../tree-operations/node-primitives';
import {
	foldLandingFor,
	publishAncestryFolds,
	publishScopeChange,
	restoreFoldedChildren
} from '../ancestry-folds';
import { saveOwnedBytes } from './saved-bytes';
import { pairsStay } from './change-record';
import type { EditorActionsDeps } from '../deps';
import type { FrameOutcome, FrameWrite } from './commit-frame';

export type TypeLeaf = (leafPath: DocPath, write: LegalWrite, caret: number) => InPlaceResult;

export function createLeafCommit(
	deps: EditorActionsDeps,
	runFrame: (write: FrameWrite) => FrameOutcome
): TypeLeaf {
	return function typeLeaf(leafPath, write, caret) {
		const depth = leafPath.length;
		const index = leafPath[depth - 1];
		let chain: CstNode[] = [];
		let body: BodyParent = documentBody(deps.doc);
		let settled: FixedUpWrite = { change: { op: 'noop' }, textStart: 0 };
		const folds: AncestrySeamFold[] = [];
		let reclassified: ContainerReclassification[] = [];
		let leafPreviousRaw = '';
		let restoreChain: (() => void) | null = null;
		let restoreIds = () => {};
		let unwindFolds: (() => void) | null = null;
		let leafBefore: NodeView | null = null;
		// Whether the write reached past the leaf: blocks fixed up beside it, or an ancestor read again.
		const moved = () => settled.change.op !== 'noop' || folds.length > 0 || reclassified.length > 0;
		// Whether the fix-up spliced the leaf's list: it can rewrite a neighbour and report no change.
		let spliced = () => false;

		const outcome = runFrame({
			entry: 'updateContent',
			// `input` promises a listener the leaf kept its kind, which the trial reparse checked.
			op: { kind: 'input', eventPath: leafPath },
			snapshot: { path: leafPath, offset: caret },
			history: 'burst',
			// A top-level write that opens, closes or moves a fence re-pairs blocks however far below.
			reach: () =>
				depth > 1 ||
				pairsStay(blockNodeAt(deps.doc, leafPath)?.raw ?? '', write.text, deps.reading.grammar)
					? { from: leafPath[0], to: leafPath[0] + 1 }
					: null,
			// Inside a container the caret's byte can cost a walk over its lines, so the record counts
			// every place the typed text could have gone instead.
			typedEnd: () => {
				if (depth > 1 || settled.change.op !== 'noop') return null;
				const top = deps.doc.children[index];
				return top ? { block: index, offset: top.leadingTrivia.length + caret } : null;
			},
			prepare() {
				leafBefore = blockNodeAt(deps.doc, leafPath);
				chain = ensureUnsharedPath(deps.doc, leafPath, deps.sharing);
				// A chain of another depth leaves the leaf's container shared with an undo entry, and
				// writing it would rewrite that entry.
				assertInvariant('unshared-spine-depth', () =>
					chain.length === depth
						? null
						: {
								code: 'unshared-spine-depth',
								message: `typeLeaf: chain depth ${chain.length} != leaf path depth ${depth}`
							}
				);
				return chain.length === depth;
			},
			apply(wasOpen) {
				const owner = depth > 1 ? chain[depth - 2] : undefined;
				// The chain reached the leaf through the owner's children, so below the root they exist.
				const siblings = savedOnWrite(owner ? owner.children! : deps.doc.children);
				body = owner
					? { children: siblings.list, owner, lineEnding: documentLineEnding(deps.doc) }
					: documentBody(deps.doc, siblings.list);
				// The fix-up writes the leaf's list only through `spliceList`, which calls this first.
				body.beforeWrite = siblings.save;
				spliced = siblings.saved;
				restoreChain = saveChain(deps, leafPath, chain, siblings.restore);
				// Read before the write: the ancestors' rebuild locates the leaf's region by these bytes.
				leafPreviousRaw = chain[depth - 1].raw;
				settled = updateNodeContent(body, index, write, deps.reading.grammar, deps.sharing);
				if (!owner) {
					settled = { ...settled, change: keepOneBlock(body, settled.change, deps.sharing) };
				}
				restoreIds = publishScopeChange(deps, owner, settled.change);
				// The top level has no ancestors to rebuild, which keeps the keystroke there cheap.
				if (depth > 1) {
					reclassified = rebuildUnsharedChain(
						deps.doc,
						chain,
						deps.sharing,
						folds,
						deps.reading.grammar,
						{ path: leafPath, leafPreviousRaw }
					);
					unwindFolds = publishAncestryFolds(deps, folds);
				}
				keepOpenTail(deps.doc, wasOpen, deps.sharing, deps.reading.grammar);
				// An ancestor's new bytes reach the view once Svelte re-reads doc.children.
				if (depth > 1) deps.doc.children = [...deps.doc.children];
				return moved();
			},
			replaced() {
				const leaf = blockNodeAt(deps.doc, leafPath);
				return moved() || !leafBefore || !leaf
					? 'unknown'
					: { before: [leafBefore], after: [leaf] };
			},
			// A container keeps its fix-up inside its own top-level block. The document's list names
			// the leaf alone only where the fix-up spliced nothing beside it.
			touched: () =>
				folds.length > 0 || reclassified.length > 0 || (depth === 1 && (moved() || spliced()))
					? null
					: [{ at: leafPath[0], removed: 1, inserted: 1 }],
			// The ancestors still in the tree, any a kind change swapped in, and the leaf where it
			// settled; the top block reads back only above a container, as a top-level leaf keeps its kind.
			written() {
				const top = deps.doc.children[leafPath[0]];
				const leaf =
					body.children[settledCaretPosition(settled, index, caret, body.children).index];
				const ancestors = attachedChainPrefix(deps.doc, chain.slice(0, -1));
				return {
					nodes: [...ancestors, ...reclassified.map((r) => r.replacement), ...(leaf ? [leaf] : [])],
					tops: depth > 1 && top ? [top] : []
				};
			},
			check({ nodes }) {
				assertLeafLineEndingPairsKept(leafPreviousRaw, write.text);
				assertWrittenUnshared(nodes, deps.sharing);
			},
			rollback() {
				// Collapses first, as the structural commit unwinds: each restores a whole parent array.
				if (unwindFolds) unwindFolds();
				else restoreFoldedChildren(folds);
				restoreIds();
				restoreChain?.();
			}
		});
		if (outcome !== 'written') return { wrote: false };
		return {
			wrote: true,
			relanding: moved()
				? relandingAfter(deps, { leafPath, chain, body, caret, settled, folds, reclassified })
				: null
		};
	};
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/**
 * What a rolled-back keystroke puts back: the chain's bytes and each chain node in its slot
 * (O(depth)), and the leaf's list as `restoreSiblings` saved it.
 */
function saveChain(
	deps: EditorActionsDeps,
	leafPath: DocPath,
	chain: CstNode[],
	restoreSiblings: () => void
): () => void {
	// Stamped, so the frame keeps no chain node: one asked about later in the write would be kept
	// half written and put back over the bytes saved here.
	for (const node of chain) deps.sharing.stamp(node);
	const restoreBytes = saveOwnedBytes(chain);
	// A write that reads the leaf as another kind in place swaps its children for the new reading's.
	const leaf = chain[chain.length - 1];
	const leafChildren = leaf.children;
	return () => {
		if (leaf.children !== leafChildren) leaf.children = leafChildren;
		restoreSiblings();
		for (let i = 0; i < chain.length; i++) {
			const parent = i === 0 ? deps.doc.children : chain[i - 1].children!;
			if (parent[leafPath[i]] !== chain[i]) parent[leafPath[i]] = chain[i];
		}
		restoreBytes();
	};
}

/** The leaf's list, copied at the fix-up's first write to it and put back by `restore`. */
function savedOnWrite(list: CstNode[]): {
	list: CstNode[];
	save(): void;
	saved(): boolean;
	restore(): void;
} {
	let before: CstNode[] | null = null;
	return {
		list,
		save: () => {
			before ??= list.slice();
		},
		saved: () => before !== null,
		restore: () => {
			if (before) spliceMany(list, 0, list.length, before);
		}
	};
}

// ── Where the caret goes after an in-place write ─────────────────────────────

interface InPlaceWritten {
	leafPath: DocPath;
	chain: CstNode[];
	body: BodyParent;
	caret: number;
	settled: FixedUpWrite;
	folds: AncestrySeamFold[];
	reclassified: ContainerReclassification[];
}

/** Where the caret goes when the write moved it off the leaf's element, first match wins: a
 *  collapsed ancestor, then one whose kind changed, then the write's own merge. */
function relandingAfter(deps: EditorActionsDeps, written: InPlaceWritten): Relanding {
	const { leafPath, settled, caret } = written;
	const parentPath = leafPath.slice(0, -1);
	const leafAt = settledCaretPosition(settled, leafPath.at(-1)!, caret, written.body.children);
	const settledPath = [...parentPath, leafAt.index];
	const byteIn = (level: number) =>
		rawOffsetOfLeaf(written.chain[level], settledPath.slice(level + 1), leafAt.offset);

	// A container that read its bytes again holds the caret by its byte position, the leaf's offset
	// having moved with whatever the re-read took (a space a widened marker swallowed).
	const fold = written.folds.at(-1);
	const foldLanding = foldLandingFor(written.folds, parentPath);
	if (fold && foldLanding) {
		return resolved(deps, foldLanding.path, foldLanding.offset + (byteIn(fold.depth) ?? 0), 1);
	}
	const outermost = written.reclassified.at(-1);
	const level = outermost ? written.chain.indexOf(outermost.previous) : -1;
	if (level >= 0) return resolved(deps, leafPath.slice(0, level + 1), byteIn(level) ?? 0, 1);

	const { change } = settled;
	const window = change.op === 'replace' ? { at: change.at, count: change.newCount } : null;
	return resolved(deps, settledPath, leafAt.offset, window?.count ?? 1, window?.at);
}

/** The position at `path` resolved to a leaf, with the window of `count` blocks from `at` (the
 *  path's own index by default) in the list that holds it. */
function resolved(
	deps: EditorActionsDeps,
	path: readonly number[],
	offset: number,
	count: number,
	at = path[path.length - 1]
): Relanding {
	const block: CaretPosition = { path: docPathFrom(path), offset };
	const leaf = caretTargetFor(deps.doc, block);
	return {
		caret: leaf ? { path: leaf.leafPath, offset: leaf.offset } : block,
		window: { list: docPathFrom(path.slice(0, -1)), at, count }
	};
}
