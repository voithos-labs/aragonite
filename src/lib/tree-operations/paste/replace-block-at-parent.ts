/**
 * Replace the block at `blockPath`, committing at its parent scope (`parent-scope.ts`)
 * rather than through the caller's blockEdit — paste-into-cell must mutate `doc.children`
 * while holding the row-level nested bundle.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { OperationDetailMap } from '../../schema/operations';
import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import type { PasteCommitCoordinator } from './paste-deps';
import { nodeAt } from '../node-ops';
import { normalizeReplacementForBody } from './body-write';
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
	/** Instance grammar for the escape's kind re-derive; absent = global. */
	grammar?: GrammarView;
	/** The clipboard's own trailing blank line, where nothing in the splice stands for it. */
	trailingSeparator?: string;
}

/**
 * Land the clipboard's trailing blank where a reload folds one: the DOCUMENT's own suffix, and
 * only at a tail whose slot is empty — one separation is one separation. A container tail
 * declines, since `innerSuffix` is the wrap-peel settle's register on this same commit.
 */
function landTrailingSeparator(
	args: ReplaceBlockAtParentArgs,
	children: CstNode[],
	afterIndex: number
): void {
	if (!args.trailingSeparator || args.blockPath.length !== 1) return;
	if (args.doc.suffix !== '' || afterIndex !== children.length) return;
	args.doc.suffix = args.trailingSeparator;
}

export async function replaceBlockAtParent(args: ReplaceBlockAtParentArgs): Promise<void> {
	const { doc, blockPath, controller, undoEntry, focusOffset, source } = args;

	const blockIdx = blockPath[blockPath.length - 1];
	const scope = resolveParentScope(doc, blockPath, controller);
	if (!scope) return;

	// A replacement is minted before any byte sink sees it, so the owner's bodyWrite escape
	// lands here — on the clipboard blocks AND the target's split halves alike.
	const ownerKind = blockPath.length > 1 ? (scope.node.kind as AnyBlockKind) : undefined;
	const { replacement, mapIndex } = normalizeReplacementForBody(
		ownerKind,
		args.replacement,
		args.grammar
	);
	const focusReplacementIndex = mapIndex(args.focusReplacementIndex);

	const oldBlock = nodeAt(doc, blockPath) as CstNode | null;
	const sameKindFirst =
		oldBlock !== null && replacement.length > 0 && replacement[0].kind === oldBlock.kind;

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
			landTrailingSeparator(args, scopeView.children, blockIdx + replacement.length);
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
