/**
 * Rewrite a byte range inside one leaf's raw as a single undo entry. The inline popovers and the
 * inline menus all write their bytes this way, through the content write every keystroke takes, so
 * a splice that fills or empties a blank line keeps the separators a reload reads.
 */

import type { Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { documentLineEnding } from '../core/lines';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { expectStateForNode } from '../reactivity/state-registry';
import type { Reading } from '../schema/reading';
import { updateNodeContent } from '../tree-operations/content-write';
import {
	documentBody,
	isBlockNode,
	nodeAt,
	normalizeOwnRaw
} from '../tree-operations/node-primitives';
import { stampStructuralChange } from '../tree-operations/structural-change';
import { ensureUnsharedChild, ensureUnsharedPath } from '../tree-operations/unshare';
import type { UndoController } from './deps';

export interface InlineRangeCommitDeps {
	getDoc: () => Document;
	controller: UndoController;
	/** The editor's reading, whose grammar the leaf kind's own raw-write rule reads. */
	reading: Reading;
}

export interface InlineRangeCommit {
	/**
	 * The length change the same splice would store once the leaf's kind rewrites it, read before
	 * committing; 0 when it would store nothing.
	 */
	writtenDelta(path: number[], start: number, end: number, bytes: string): number;
	/** Splice `bytes` over `[start, end)` of the leaf at `path`; the undo entry restores the caret
	 *  to `caretAfter`. Resolves whether the leaf holds the bytes (true for a no-change splice). */
	commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	): Promise<boolean>;
}

export function createInlineRangeCommit(deps: InlineRangeCommitDeps): InlineRangeCommit {
	function leafAt(path: number[]) {
		if (path.length === 0) return null;
		const leaf = nodeAt(deps.getDoc() as DocumentView, path);
		return leaf !== null && isBlockNode(leaf) ? leaf : null;
	}

	/** The spliced raw, or null when there is no leaf or the kind would store the bytes it has. */
	function planSplice(path: number[], start: number, end: number, bytes: string) {
		const leaf = leafAt(path);
		if (leaf === null) return null;
		const newRaw = leaf.raw.slice(0, start) + bytes + leaf.raw.slice(end);
		// Compared against the bytes the kind would actually store (G4.28), so a splice a table
		// cell's pipe escaping cancels out adds no undo entry (dismissing an image after a resize).
		const legal = normalizeOwnRaw(leaf, newRaw, documentLineEnding(deps.getDoc()));
		return legal === leaf.raw ? null : { newRaw, legal, delta: legal.length - leaf.raw.length };
	}

	function writtenDelta(path: number[], start: number, end: number, bytes: string): number {
		return planSplice(path, start, end, bytes)?.delta ?? 0;
	}

	async function commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number
	): Promise<boolean> {
		const plan = planSplice(path, start, end, bytes);
		if (!plan) return leafAt(path) !== null;
		const { newRaw } = plan;

		const { controller } = deps;
		const snapshot = { path: docPathFrom(path), offset: caretAfter };
		const leafIdx = path[path.length - 1];
		const op = {
			kind: 'updateContent' as const,
			detail: { length: plan.legal.length },
			eventPath: docPathFrom(path)
		};
		if (path.length === 1) {
			return controller.commitStructural({
				snapshot,
				mutate: (children) => {
					ensureUnsharedPath({ children }, [leafIdx], controller.sharing);
					const { change } = updateNodeContent(
						documentBody(deps.getDoc(), children),
						leafIdx,
						newRaw,
						deps.reading.grammar,
						controller.sharing
					);
					stampStructuralChange(children, change, controller.sharing);
					return change;
				},
				op
			});
		}

		// path.length > 1, so the parent is a container node, never the root.
		const container: NodeView | DocumentView | null = nodeAt(
			deps.getDoc() as DocumentView,
			path.slice(0, -1)
		);
		if (container === null || !isBlockNode(container)) return false;
		return controller.commitContainerStructural({
			containerNode: container,
			path: path.slice(0, -1),
			state: expectStateForNode(container),
			snapshot,
			mutate: (scope) => {
				ensureUnsharedChild(scope.node, leafIdx, scope.sharing);
				const { change } = updateNodeContent(
					scope.body,
					leafIdx,
					newRaw,
					deps.reading.grammar,
					scope.sharing
				);
				stampStructuralChange(scope.children, change, scope.sharing);
				return change;
			},
			op
		});
	}

	return { writtenDelta, commitInlineRange };
}
