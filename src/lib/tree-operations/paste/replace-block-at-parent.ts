/**
 * Replace the block at `blockPath`, committing at its parent scope (`parent-scope.ts`)
 * rather than through the caller's blockEdit — paste-into-cell must mutate `doc.children`
 * while holding the row-level nested bundle.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { OperationDetailMap } from '../../schema/operations';
import type { CstNode, Document } from '../../core/nodes';
import type { PasteCommitCoordinator } from './paste-deps';
import { nodeAt, restoreSeparatorAfterBlank } from '../node-ops';
import { isBlankParagraph } from '../../core/parser';
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
	// The slot's blank line was the separator of the block below it as well as its own; both
	// ends of the splice have to take one back once the replacement consumes it (GH #73).
	const replacedBlank = oldBlock !== null && isBlankParagraph(oldBlock);

	await controller.commitMultiScope({
		scopes: [scope],
		snapshot: undoEntry === 'join' ? 'skip' : { path: docPathFrom(blockPath), offset: 0 },
		mutate: ([scopeView]) => {
			scopeView.children.splice(blockIdx, 1, ...replacement);
			// Identity preservation only helps on a kind match; BlockHost dispatches by kind,
			// so a different kind remounts anyway.
			const change: StructuralChange = sameKindFirst
				? replacePreservingFirst(blockIdx, 1, replacement.length)
				: { op: 'replace', at: blockIdx, count: 1, newCount: replacement.length };
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			if (replacedBlank) {
				const parent = { children: scopeView.children, ownerKind: scopeView.node.kind };
				restoreSeparatorAfterBlank(parent, blockIdx, scopeView.sharing);
				restoreSeparatorAfterBlank(parent, blockIdx + replacement.length, scopeView.sharing);
			}
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
