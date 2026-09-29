/** Applies the results a paste surface hook produced to the document. `start` is where the paste
 *  began, which each commit records as undo's caret. */

import type { CommitSnapshotArg } from '../../action-contracts';
import { leafAtRawOffset } from '../container-offsets';
import { blockNodeAt } from '../node-primitives';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext, InlineCaretLanding } from './dispatch';

/**
 * Apply an inline paste, reporting where the caret lands in the stored bytes. A cross-block paste
 * commits at the parent list, since the originating action bundle may not match the target's level.
 */
export async function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext,
	start: CommitSnapshotArg
): Promise<InlineCaretLanding | undefined> {
	if (ctx.crossBlock) {
		return commitInlineCrossBlock(targetPath, result, ctx, start);
	}

	// Unawaited, so the caller places the caret before the first reactive flush and both land in
	// that one flush.
	const blockIndex = targetPath[targetPath.length - 1];
	const write = ctx.blockEdit.updateBlockContent(
		blockIndex,
		result.newRaw,
		'literal',
		start.offset,
		result.caretOffset
	);
	return write.admitted ? { path: targetPath, offset: write.caret } : undefined;
}

/**
 * Cross-block inline paste, committed at the parent list so its `childIds` stay aligned. The write
 * goes through the reparse path, so a paste that completes marker syntax changes the block's kind.
 */
async function commitInlineCrossBlock(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext,
	start: CommitSnapshotArg
): Promise<InlineCaretLanding | undefined> {
	const landed = await ctx.controller.commitLeafText(targetPath, result.newRaw, {
		caret: result.caretOffset,
		snapshotOffset: start.offset
	});
	if (!landed.wrote) return undefined;
	// The paste can make the block a container, whose caret belongs in the leaf holding the offset.
	const blockPath = [...landed.caret.path];
	const block = blockNodeAt(ctx.doc, blockPath);
	const leaf = block?.children?.length ? leafAtRawOffset(block, landed.caret.offset) : null;
	return {
		path: [...blockPath, ...(leaf?.path ?? [])],
		offset: leaf?.offset ?? landed.caret.offset
	};
}

export async function applyStructuralResult(
	targetPath: number[],
	result: StructuralPasteResult,
	ctx: PasteDispatchContext,
	start: CommitSnapshotArg,
	trailingSeparator = ''
): Promise<void> {
	await ctx.controller.replaceBlock(
		targetPath,
		result.replacement,
		{ replacementIndex: result.focusReplacementIndex, offset: result.focusOffset },
		{
			source: 'paste-dispatch',
			trailingBlank: trailingSeparator !== '',
			snapshotOffset: start.offset
		}
	);
}
