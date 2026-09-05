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
import { spliceMany } from '../splice-many';
import { trailingLineEnding } from '../../core/lines';
import { normalizeReplacementForBody } from './body-write';
import { landedPasteOffset, trackedPasteCaret } from './focus-target';
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
 * declines, since `innerSuffix` is the wrap-peel settle's register on this same commit. The
 * clipboard says WHETHER a line lands, never which one: normalized to LF at every entry point,
 * its own suffix would strand an LF line in a CRLF document (G4.20).
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
	// The settle can fold the spliced window into its neighbours, which moves both halves of the
	// landing: the residue reattaches inside the last pasted leaf, and an absorb above moves the
	// slot itself. The commit carries this through its folds and `afterTick` reads it back.
	const caret = trackedPasteCaret(replacement, blockIdx, focusReplacementIndex, focusOffset);

	const oldBlock = nodeAt(doc, blockPath) as CstNode | null;
	const sameKindFirst =
		oldBlock !== null && replacement.length > 0 && replacement[0].kind === oldBlock.kind;
	// Read as bytes before the commit: the displaced block is the document's own ending, and a
	// node held across a commit goes stale the moment the spine unshares.
	const tailEnding = oldBlock ? trailingLineEnding(oldBlock.raw) : '\n';

	await controller.commitMultiScope({
		scopes: [scope],
		snapshot: undoEntry === 'join' ? 'skip' : { path: docPathFrom(blockPath), offset: 0 },
		mutate: ([scopeView]) => {
			spliceMany(scopeView.children, blockIdx, 1, replacement);
			// Identity preservation only helps on a kind match; BlockHost dispatches by kind,
			// so a different kind remounts anyway.
			const change: StructuralChange = sameKindFirst
				? replacePreservingFirst(blockIdx, 1, replacement.length)
				: { op: 'replace', at: blockIdx, count: 1, newCount: replacement.length };
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
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
			// Re-read from the document: the ceremony unshares the spine, so the scope node the
			// caller resolved is a stale copy by now.
			const landed = nodeAt(doc, scope.path)?.children?.[caret.index];
			return controller.landCaret(
				[...scope.path, caret.index],
				landedPasteOffset(landed, caret, focusOffset)
			);
		}
	});
}
