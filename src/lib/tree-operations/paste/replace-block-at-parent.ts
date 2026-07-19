/**
 * Replace a single block at `blockPath` with `replacement` blocks via the
 * controller's commitMultiScope, bypassing whatever blockEdit happens to be in
 * scope. Used for paste paths that splice into a parent the caller's blockEdit
 * can't address — e.g., paste-into-cell needs to mutate doc.children but the
 * cell's blockEdit is the row-level nested bundle (which would treat the
 * doc-level table index as a column index inside the row).
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { OperationDetailMap } from '../../schema/operations';
import type { CstNode, Document } from '../../core/nodes';
import type { PasteCommitCoordinator, MultiScopeTarget } from './paste-deps';
import { nodeAt } from '../node-ops';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../structural-change';

export interface ReplaceBlockAtParentArgs {
	doc: Document;
	/** Path to the block being replaced. Length ≥ 1. */
	blockPath: number[];
	replacement: CstNode[];
	controller: PasteCommitCoordinator;
	undoEntry: UndoEntryMode;
	/** Index into `replacement` to focus after the commit. */
	focusReplacementIndex: number;
	focusOffset: number;
	source: Extract<OperationDetailMap['replaceBlock'], { source: unknown }>['source'];
}

export async function replaceBlockAtParent(args: ReplaceBlockAtParentArgs): Promise<void> {
	const {
		doc,
		blockPath,
		replacement,
		controller,
		undoEntry,
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
		: { node: parentNode!, state: controller.expectState(parentNode!), path: parentPath };

	const oldBlock = nodeAt(doc, blockPath) as CstNode | null;
	const sameKindFirst =
		oldBlock !== null && replacement.length > 0 && replacement[0].kind === oldBlock.kind;

	await controller.commitMultiScope({
		scopes: [scope],
		snapshot: undoEntry === 'join' ? 'skip' : { path: docPathFrom(blockPath), offset: 0 },
		mutate: ([scopeView]) => {
			scopeView.children.splice(blockIdx, 1, ...replacement);
			// Identity preservation only helps when the kind matches — different
			// kinds remount anyway because BlockHost dispatches by kind.
			const change: StructuralChange = sameKindFirst
				? replacePreservingFirst(blockIdx, 1, replacement.length)
				: { op: 'replace', at: blockIdx, count: 1, newCount: replacement.length };
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			return [change];
		},
		op: {
			kind: 'replaceBlock',
			detail: { source },
			eventPath: docPathFrom(blockPath)
		},
		afterTick: () => {
			const focusIdx = blockIdx + focusReplacementIndex;
			scope.state.innerBlockRefs[focusIdx]?.focus(focusOffset);
		}
	});
}
