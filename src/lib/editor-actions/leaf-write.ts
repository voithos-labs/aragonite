/**
 * The two parts of a keystroke only the editor root can do, shared by every level's
 * `updateBlockContent`: grouping the keystroke with its typing burst in the undo history, and the
 * write that keeps the leaf in place outside a commit. A container reaches both through its
 * `ContainerEditActions`.
 */

import type { ContainerEditActions, InPlaceResult, Relanding } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import { documentLineEnding } from '../core/lines';
import { assertInvariant } from '../assert';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { caretTargetFor } from '../selection/caret-target';
import type { CaretPosition } from '../selection/primitives';
import type { DocPath } from '../selection/path-math';
import {
	settledCaretPosition,
	updateNodeContent,
	type SettledContent
} from '../tree-operations/content-write';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { blockNodeAt, documentBody, type BodyParent } from '../tree-operations/node-primitives';
import { rawOffsetOfLeaf } from '../tree-operations/container-offsets';
import {
	rebuildUnsharedChain,
	type AncestrySeamFold,
	type ContainerReclassification
} from '../tree-operations/chain-rebuild';
import { foldLandingFor, publishAncestryFolds, publishScopeFold } from './ancestry-folds';
import { admitsWrite } from './commit/reading-write-gate';
import type { EditorActionsDeps, UndoController } from './deps';

export type { InPlaceResult, Relanding };

/** `typeInLeaf` also starts the pause timer when `work` settles, throw included; `writeLeafInPlace`
 *  copies the path, writes, publishes ids and the content version, and rebuilds the ancestors. */
export type LeafTyping = Pick<ContainerEditActions, 'typeInLeaf' | 'writeLeafInPlace'>;

export function createLeafTyping(deps: EditorActionsDeps, controller: UndoController): LeafTyping {
	return {
		typeInLeaf(leafPath, preEditOffset, batchKey, work) {
			controller.pushUndoSnapshotDebounced(leafPath, preEditOffset, batchKey);
			// A batch whose pause timer never started never ends on a pause, so the timer starts
			// even when the keystroke's work throws.
			return controller.joinTypingBatch(work).finally(() => controller.armUndoPause());
		},

		writeLeafInPlace(leafPath, write, caret) {
			const kindOf = () => blockNodeAt(deps.doc, leafPath)?.kind;
			// A backstop: the keystroke asks the reading-mode check before it picks this route.
			if (!admitsWrite(deps.reading, 'updateContent', kindOf)) return { wrote: false };
			const chain = ensureUnsharedPath(deps.doc, leafPath, deps.sharing);
			// A shorter chain would leave the leaf's container shared with an undo entry, and
			// writing it would rewrite that entry (G1.20).
			assertInvariant('unshared-spine-depth', () =>
				chain.length === leafPath.length
					? null
					: {
							code: 'unshared-spine-depth',
							message: `writeLeafInPlace: chain depth ${chain.length} != leaf path depth ${leafPath.length}`
						}
			);
			if (chain.length !== leafPath.length) return { wrote: false };

			const depth = leafPath.length;
			const owner = depth > 1 ? chain[depth - 2] : undefined;
			// The chain reached the leaf through the owner's children, so below the root they exist.
			const body: BodyParent = owner
				? { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) }
				: documentBody(deps.doc);
			// Read before the write: the ancestors' rebuild locates the leaf's region by these bytes.
			const leafPreviousRaw = chain[depth - 1].raw;
			const settled = updateNodeContent(
				body,
				leafPath[depth - 1],
				write,
				deps.reading.grammar,
				deps.sharing
			);
			publishScopeFold(deps, owner, settled.change);

			const folds: AncestrySeamFold[] = [];
			let reclassified: ContainerReclassification[] = [];
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
				publishAncestryFolds(deps, folds);
				// Raw written outside a commit reaches the view once Svelte re-reads doc.children.
				deps.doc.children = [...deps.doc.children];
			}
			// State first, then the announcement, as a commit does.
			deps.bumpContentVersion();
			const moved = settled.change.op !== 'noop' || folds.length > 0 || reclassified.length > 0;
			return {
				wrote: true,
				relanding: moved
					? relandingAfter(deps, { leafPath, chain, body, caret, settled, folds, reclassified })
					: null
			};
		}
	};
}

// ── Where the caret goes after an in-place write ─────────────────────────────

interface InPlaceWritten {
	leafPath: DocPath;
	chain: CstNode[];
	body: BodyParent;
	caret: number;
	settled: SettledContent;
	folds: AncestrySeamFold[];
	reclassified: ContainerReclassification[];
}

/**
 * The caret after a write that moved it off the leaf's element, resolved to a leaf on the tree the
 * write left: an ancestor that collapsed first, then one whose kind changed, then the write's own
 * merge. An ancestor's landing reads the caret's byte in that ancestor's bytes.
 */
function relandingAfter(deps: EditorActionsDeps, written: InPlaceWritten): Relanding {
	const { leafPath, settled, caret } = written;
	const parentPath = leafPath.slice(0, -1);
	const leafAt = settledCaretPosition(settled, leafPath.at(-1)!, caret, written.body.children);
	const settledPath = [...parentPath, leafAt.index];
	const byteIn = (level: number) =>
		rawOffsetOfLeaf(written.chain[level], settledPath.slice(level + 1), leafAt.offset);

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
