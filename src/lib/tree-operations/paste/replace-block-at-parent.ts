/**
 * Replace a single block at `blockPath` with `replacement` blocks via the
 * controller's commitMultiScope, bypassing whatever blockEdit happens to be in
 * scope. Used for paste paths that splice into a parent the caller's blockEdit
 * can't address — e.g., paste-into-cell needs to mutate doc.children but the
 * cell's blockEdit is the row-level nested bundle (which would treat the
 * doc-level table index as a column index inside the row).
 */

import type { CstNode, Document } from '../../core/nodes';
import type { PasteCommitCoordinator, MultiScopeTarget } from './paste-deps';
import { nodeAt } from '../node-ops';
import { rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import { expectStateForNode } from '../../reactivity/state-registry';

export interface ReplaceBlockAtParentArgs {
	doc: Document;
	/** Path to the block being replaced. Length ≥ 1. */
	blockPath: number[];
	replacement: CstNode[];
	controller: PasteCommitCoordinator;
	skipSnapshot: boolean;
	/** Index into `replacement` to focus after the commit. */
	focusReplacementIndex: number;
	focusOffset: number;
	source: string;
}

export async function replaceBlockAtParent(args: ReplaceBlockAtParentArgs): Promise<void> {
	const {
		doc,
		blockPath,
		replacement,
		controller,
		skipSnapshot,
		focusReplacementIndex,
		focusOffset,
		source
	} = args;

	const parentPath = blockPath.slice(0, -1);
	const blockIdx = blockPath[blockPath.length - 1];
	const isTopLevel = parentPath.length === 0;
	const parentNode = isTopLevel ? null : (nodeAt(doc, parentPath) as CstNode | null);
	if (!isTopLevel && (!parentNode || !parentNode.children)) return;

	const scope: MultiScopeTarget = isTopLevel
		? controller.getDocScope()
		: { node: parentNode!, state: expectStateForNode(parentNode!) };

	const oldBlock = nodeAt(doc, blockPath) as CstNode | null;
	const sameKindFirst =
		oldBlock !== null && replacement.length > 0 && replacement[0].kind === oldBlock.kind;

	await controller.commitMultiScope({
		scopes: [scope],
		snapshot: skipSnapshot ? 'skip' : { blockIndex: blockPath[0], offset: 0 },
		mutate: (scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(blockIdx, 1, ...replacement);
			if (!isTopLevel) {
				parentNode!.children = children;
				rebuildAncestryRawForLeaf(doc, [...parentPath, blockIdx]);
			}
			// First replacement inherits the original block's id + ref when the
			// kind matches, preserving Svelte component identity (IME composition
			// state, pending input). Different kinds remount anyway because
			// BlockHost dispatches by kind.
			return [
				{
					op: 'replace',
					at: blockIdx,
					count: 1,
					newCount: replacement.length,
					...(sameKindFirst ? { idMap: { 0: 0 } } : {})
				}
			];
		},
		op: {
			kind: 'replaceBlock',
			detail: { source },
			eventPath: blockPath
		},
		afterTick: () => {
			const focusIdx = blockIdx + focusReplacementIndex;
			scope.state.innerBlockRefs[focusIdx]?.focus(focusOffset);
		}
	});
}
