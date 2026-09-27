/**
 * Typing a character over a cross-block range: delete the range, splice the character into the
 * surviving leaf and reparse it, so a marker typed at offset 0 changes the kind as single-block
 * typing does. A range holding one block whole leaves no surviving leaf, so the character
 * replaces that block instead.
 */

import { documentLineEnding } from '../../core/lines';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import { performCrossBlockDelete, rangeUndoStep } from './ops';
import { charOffsetOf } from '../primitives';
import { blockCoveredWhole } from '../covered-block';
import { CURSOR_END } from '../../block-component';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { focusCollapsedCaret } from '../native-bridge';
import { caretTargetFor } from '../caret-target';

export async function handleCrossBlockTypeReplace(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	typed: string
): Promise<void> {
	// A range holding its block whole leaves no leaf to splice into, so the character replaces the
	// block in its own position. An empty insertion has nothing to put there and takes the delete.
	const covered = typed
		? blockCoveredWhole(ctx.getDoc(), ctx.selection.anchor, ctx.selection.focus)
		: null;
	if (covered) {
		await replaceCoveredBlockWithText(ctx, mutCtx, typed, covered);
		return;
	}
	// One entry for the delete and the character.
	await rangeUndoStep(mutCtx, () => deleteThenType(ctx, mutCtx, typed));
}

async function deleteThenType(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	typed: string
): Promise<void> {
	const caret = await performCrossBlockDelete(mutCtx, { skipCaretRestore: true });
	if (!caret) return;
	// All caret placements below target caret.path's top-level block; mount it once here so each
	// (the post-tick landing included) finds a live element.
	await ctx.revealPath(caret.path);
	const targetNode = typed ? blockNodeAt(ctx.getDoc(), caret.path) : null;
	if (!targetNode) {
		focusCollapsedCaret(ctx.getBlockElByPath, caret);
		return;
	}

	// The typed character goes through the write every keystroke takes, so a marker typed at offset
	// 0 re-derives the kind and the container's rule escapes what it must.
	const leafIndex = caret.path[caret.path.length - 1];
	const charOffset = charOffsetOf(caret, 'cross-block-type-replace:slice');
	const text = targetNode.raw.slice(0, charOffset) + typed + targetNode.raw.slice(charOffset);
	const written = await ctx.pasteCoordinator.commitLeafText(caret.path, text, {
		caret: charOffset + typed.length,
		snapshotOffset: caret.offset,
		afterTick: async (landed) => {
			const at = [...landed.caret.path];
			// A fix-up that merged the leaf into the block above left that block holding the typed
			// bytes, somewhere the mount above may never have drawn.
			if (at[at.length - 1] !== leafIndex) await ctx.revealPath(at);
			const leaf = caretTargetFor(ctx.getDoc(), landed.caret);
			focusCollapsedCaret(
				ctx.getBlockElByPath,
				leaf
					? { path: [...leaf.leafPath], offset: leaf.offset }
					: { path: at, offset: landed.caret.offset }
			);
		}
	});
	if (!written.wrote) focusCollapsedCaret(ctx.getBlockElByPath, caret);
}

/** Parses the typed character in place of the covered block, through the same call the
 *  covered-block paste makes, so a marker typed over the block derives its kind as typing does. */
async function replaceCoveredBlockWithText(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	typed: string,
	blockPath: number[]
): Promise<void> {
	const doc = ctx.getDoc();
	const covered = blockNodeAt(doc, blockPath);
	if (!covered) return;
	const parsed = parseReplacement(covered, typed, documentLineEnding(doc), ctx.reading.grammar);
	if (!parsed) return;

	// Opened before the collapse, so the entry holds the range rather than the caret it leaves.
	await rangeUndoStep(mutCtx, async () => {
		ctx.selection.collapse();
		await ctx.pasteCoordinator.replaceBlock(
			blockPath,
			parsed.replacement,
			{ replacementIndex: parsed.replacement.length - 1, offset: CURSOR_END },
			{ source: 'cross-block-covered-block' }
		);
	});
}
