/**
 * Rewrite a byte range inside one leaf's raw as a single undo entry. The inline popovers and the
 * inline menus all write their bytes this way, through the content write every keystroke takes, so
 * a splice that fills or empties a blank line keeps the separators a reload reads.
 */

import type { Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { expectStateForNode } from '../reactivity/state-registry';
import type { GrammarView } from '../schema/block-openers';
import { updateNodeContent } from '../tree-operations/content-write';
import { isBlockNode, nodeAt, normalizeOwnRaw } from '../tree-operations/node-primitives';
import { stampStructuralChange } from '../tree-operations/structural-change';
import { ensureUnsharedChild, ensureUnsharedPath } from '../tree-operations/unshare';
import { scopeParentOf } from './block-edit-scope';
import type { UndoController } from './deps';

export interface InlineRangeCommitDeps {
	getDoc: () => Document;
	controller: UndoController;
	/** The instance's grammar, for the leaf kind's own raw-write rule. */
	grammar: GrammarView;
}

export interface InlineRangeCommit {
	/**
	 * The length change the same splice would store once the leaf's kind rewrites it, read before
	 * committing; 0 when it would store nothing.
	 */
	writtenDelta(path: number[], start: number, end: number, bytes: string): number;
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
	/** The leaf and its spliced raw, or null when the kind would store the bytes it has. */
	function planSplice(path: number[], start: number, end: number, bytes: string) {
		if (path.length === 0) return null;
		const leaf = nodeAt(deps.getDoc() as DocumentView, path);
		if (leaf === null || !isBlockNode(leaf)) return null;
		const newRaw = leaf.raw.slice(0, start) + bytes + leaf.raw.slice(end);
		// Compared against the bytes the kind would actually store (G4.28), so a splice a table
		// cell's pipe escaping cancels out adds no undo entry (dismissing an image after a resize).
		const legal = normalizeOwnRaw(leaf, newRaw);
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
	): Promise<void> {
		const plan = planSplice(path, start, end, bytes);
		if (!plan) return;
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
			await controller.commitStructural({
				snapshot,
				mutate: (children) => {
					ensureUnsharedPath({ children }, [leafIdx], controller.sharing);
					const doc = deps.getDoc();
					const parent = {
						children,
						ownerKind: undefined,
						owner: undefined,
						get suffix() {
							return doc.suffix;
						},
						set suffix(value: string) {
							doc.suffix = value;
						}
					};
					const { change } = updateNodeContent(
						parent,
						leafIdx,
						newRaw,
						deps.grammar,
						controller.sharing
					);
					stampStructuralChange(children, change, controller.sharing);
					return change;
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
				ensureUnsharedChild(scope.node, leafIdx, scope.sharing);
				const { change } = updateNodeContent(
					scopeParentOf(scope),
					leafIdx,
					newRaw,
					deps.grammar,
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
