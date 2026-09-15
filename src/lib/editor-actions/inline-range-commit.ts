/**
 * Rewrite a byte range inside one leaf's raw as a single undo entry. The inline popovers
 * (image properties, link card) all write their bytes this way, so the choice of commit
 * (top-level or container) and the no-op discard live here rather than in each popover.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { expectStateForNode } from '../reactivity/state-registry';
import type { GrammarView } from '../schema/block-openers';
import {
	isBlockNode,
	nodeAt,
	normalizeOwnRaw,
	writeOwnRaw
} from '../tree-operations/node-primitives';
import { ensureUnsharedChild, ensureUnsharedPath } from '../tree-operations/unshare';
import type { UndoController } from './deps';

export interface InlineRangeCommitDeps {
	getDoc: () => Document;
	controller: UndoController;
	/** The instance's grammar, for the leaf kind's own raw-write rule. Absent = the global grammar. */
	grammar?: GrammarView;
}

export interface InlineRangeCommit {
	/** Splice `bytes` over `[start, end)` of the leaf at `path`; `caretAfter` is the raw offset the
	 *  entry's snapshot restores. A splice that changes no byte commits nothing. */
	commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	): Promise<void>;
}

export function createInlineRangeCommit(deps: InlineRangeCommitDeps): InlineRangeCommit {
	async function commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	): Promise<void> {
		if (path.length === 0) return;
		const leaf = nodeAt(deps.getDoc() as DocumentView, path);
		if (leaf === null || !isBlockNode(leaf)) return;
		const newRaw = leaf.raw.slice(0, start) + bytes + leaf.raw.slice(end);
		// Compared against the bytes the kind would actually store (G4.28), so a splice a table
		// cell's pipe escaping cancels out adds no undo entry (dismissing an image after a resize).
		const legal = normalizeOwnRaw(leaf, newRaw);
		if (legal === leaf.raw) return;

		const { controller } = deps;
		const snapshot = { path: docPathFrom(path), offset: caretAfter };
		const leafIdx = path[path.length - 1];
		const op = {
			kind: 'updateContent' as const,
			detail: { length: legal.length },
			eventPath: docPathFrom(path)
		};
		const writeRaw = (node: CstNode) => {
			writeOwnRaw(node, newRaw, deps.grammar);
		};

		if (path.length === 1) {
			await controller.commitStructural({
				snapshot,
				mutate: (children) => {
					const [owned] = ensureUnsharedPath({ children }, [leafIdx], controller.sharing);
					writeRaw(owned);
					return { op: 'noop' as const };
				},
				op
			});
			return;
		}

		// path.length > 1, so the parent is a container node, never the root.
		const container: NodeView | DocumentView | null = nodeAt(
			deps.getDoc() as DocumentView,
			path.slice(0, -1)
		);
		if (container === null || !isBlockNode(container)) return;
		await controller.commitContainerStructural({
			containerNode: container,
			path: path.slice(0, -1),
			state: expectStateForNode(container),
			snapshot,
			mutate: (scope) => {
				writeRaw(ensureUnsharedChild(scope.node, leafIdx, scope.sharing));
				return { op: 'noop' as const };
			},
			op
		});
	}

	return { commitInlineRange };
}
