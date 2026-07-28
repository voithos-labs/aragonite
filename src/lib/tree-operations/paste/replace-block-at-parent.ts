/**
 * Replace a single block at `blockPath` with `replacement` blocks, committing at
 * the block's parent scope (`parent-scope.ts`) rather than through the caller's
 * blockEdit — paste-into-cell has to mutate doc.children while holding the
 * row-level nested bundle.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { OperationDetailMap } from '../../schema/operations';
import type { CstNode, Document } from '../../core/nodes';
import type { PasteCommitCoordinator } from './paste-deps';
import { nodeAt } from '../node-ops';
import { resolveParentScope } from './parent-scope';
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

	const blockIdx = blockPath[blockPath.length - 1];
	const scope = resolveParentScope(doc, blockPath, controller);
	if (!scope) return;

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
		afterTick: () =>
			controller.landCaret([...scope.path, blockIdx + focusReplacementIndex], focusOffset)
	});
}
