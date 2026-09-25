/**
 * Replace the block at `blockPath`, committing at its parent scope (`parent-scope.ts`)
 * rather than through the caller's blockEdit: a paste into a cell must mutate `doc.children`
 * while holding the row-level nested bundle.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { OperationDetailMap } from '../../schema/operations';
import type { AnyBlockKind, CstNode, Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import type { PasteCommitCoordinator } from './paste-deps';
import { nodeAt } from '../node-primitives';
import { spliceMany } from '../splice-many';
import { documentLineEnding } from '../../core/lines';
import { normalizeReplacementForBody } from './body-write';
import { reconcileTaskMetadata, taskMarkerMayStandBefore } from '../list/reconcile-task';
import { landedPastePosition, trackedPasteCaret } from './focus-target';
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
	/** Instance grammar for the escape's kind re-derive. */
	grammar: GrammarView;
	/** The clipboard's own trailing blank line, where nothing in the splice stands for it. */
	trailingSeparator?: string;
}

/**
 * Land the clipboard's trailing blank line where a reload keeps one: the document's own suffix,
 * and only at a tail with nothing after it, since one separation is one separation. A container
 * tail declines: `innerSuffix` belongs to the fence-line fix-up on this same commit. The
 * clipboard says whether a line lands, never which one: the document's ending does (G4.20).
 */
function landTrailingSeparator(
	args: ReplaceBlockAtParentArgs,
	children: CstNode[],
	afterIndex: number,
	ending: '\n' | '\r\n'
): void {
	if (!args.trailingSeparator || args.blockPath.length !== 1) return;
	if (args.doc.suffix !== '' || afterIndex !== children.length) return;
	args.doc.suffix = ending;
}

/** Returns how many blocks landed in the position: the body rule below can rewrite the list, so
 *  a caller whose next write addresses a later sibling asks here rather than counting its own. */
export async function replaceBlockAtParent(args: ReplaceBlockAtParentArgs): Promise<number> {
	const { doc, blockPath, controller, undoEntry, focusOffset, source } = args;

	const blockIdx = blockPath[blockPath.length - 1];
	const scope = resolveParentScope(doc, blockPath, controller);
	if (!scope) return 0;

	// A replacement is built before any content write sees it, so the owner's `bodyWrite` escape
	// is applied here, to the clipboard blocks and the target's split halves alike.
	const ownerKind = blockPath.length > 1 ? (scope.node.kind as AnyBlockKind) : undefined;
	const lineEnding = documentLineEnding(doc);
	const { replacement, mapIndex } = normalizeReplacementForBody(
		ownerKind,
		args.replacement,
		lineEnding,
		args.grammar
	);
	const focusReplacementIndex = mapIndex(args.focusReplacementIndex);
	// The fix-up's merges can move the caret target (a residue joining the last pasted leaf, a
	// merge above), so the commit keeps this position updated and `afterTick` reads it back.
	const caret = trackedPasteCaret(replacement, blockIdx, focusReplacementIndex, focusOffset);

	const oldBlock = nodeAt(doc, blockPath) as CstNode | null;
	const sameKindFirst =
		oldBlock !== null && replacement.length > 0 && replacement[0].kind === oldBlock.kind;
	const tailEnding = lineEnding;

	await controller.commitMultiScope({
		scopes: [scope],
		snapshot: undoEntry === 'join' ? 'skip' : { path: docPathFrom(blockPath), offset: 0 },
		mutate: ([scopeView]) => {
			// Read before the splice, for the task-marker rule below.
			const stood = taskMarkerMayStandBefore(scopeView.children[blockIdx]);
			spliceMany(scopeView.children, blockIdx, 1, replacement);
			// Identity preservation only helps on a kind match; BlockHost dispatches by kind,
			// so a different kind remounts anyway.
			const change: StructuralChange = sameKindFirst
				? replacePreservingFirst(blockIdx, 1, replacement.length)
				: { op: 'replace', at: blockIdx, count: 1, newCount: replacement.length };
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			// The third write that can put a new block in a list item's first position, and so take
			// the task marker with the paragraph that carried it.
			reconcileTaskMetadata(scopeView.node, blockIdx, stood, scopeView.sharing);
			landTrailingSeparator(args, scopeView.children, blockIdx + replacement.length, tailEnding);
			return [change];
		},
		op: {
			kind: 'replaceBlock',
			detail: { source },
			eventPath: docPathFrom(blockPath)
		},
		trackCaret: [caret],
		afterTick: () => {
			// Re-read from the document: the commit copies the ancestors, so the scope node the
			// caller resolved is a stale copy by now.
			const landed = nodeAt(doc, scope.path)?.children?.[caret.index];
			const at = landedPastePosition(landed, caret, focusOffset);
			return controller.landCaret([...scope.path, caret.index, ...at.path], at.offset);
		}
	});
	return replacement.length;
}
