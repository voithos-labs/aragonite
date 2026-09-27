/**
 * Cross-block paste: delete the range and paste at the collapsed caret as one undo entry, then
 * restore the caret through the DOM, since the block the paste started in may be gone.
 */

import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import type { Document } from '../../core/nodes';
import type { SelectionState } from '../selection-state.svelte';
import { countsCells, tableCellCount } from '../../schema/block-kind-descriptor';
import { CURSOR_END } from '../../block-component';
import { documentLineEnding, normalizeLineEndings } from '../../core/lines';
import { performCrossBlockDelete, rangeUndoStep } from './ops';
import { charOffsetOf } from '../primitives';
import { focusCollapsedCaret } from '../native-bridge';
import { blockCoveredWhole } from '../covered-block';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { blockNodeAt, nodeAt } from '../../tree-operations/node-primitives';
import { pathsEqual } from '../path-math';
import { parseReplacement } from '../../tree-operations/paste/replacement-parse';
import { emitClipboardError } from '../../editor-events';

export async function handleCrossBlockPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: ClipboardEvent | null,
	replacement?: string
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock) return false;

	ctx.caretMemory.forget();
	ctx.selection.resetSelectAllCount();
	e?.preventDefault();
	// `!== undefined`, not `??`: a caller supplying its own payload must never reach the
	// clipboard read, and `??` would make that depend on callers never passing ''.
	const pasted =
		replacement !== undefined
			? replacement
			: normalizeLineEndings(e?.clipboardData?.getData('text/plain') ?? '');
	if (!pasted) return true;

	const doc = ctx.getDoc();

	// The range holds one block whole, in either addressing: replace the block at its parent
	// position, single undo. A sub-rectangle inside a table only clears cells, leaving the table.
	const covered =
		wholeTablePath(ctx.selection, doc) ??
		blockCoveredWhole(doc, ctx.selection.anchor, ctx.selection.focus);
	if (covered) {
		await replaceCoveredBlockWithPaste(ctx, mutCtx, pasted, covered);
		return true;
	}

	// Read before the delete collapses the selection: the only coordinate an error report on the
	// declined branch below could still name.
	const rangeStartPath = ctx.selection.start?.path.slice();

	// One entry for the delete and the paste, so Ctrl+Z never stops between them.
	await rangeUndoStep(mutCtx, async () => {
		const caret = await performCrossBlockDelete(mutCtx, { skipCaretRestore: true });
		// The paste was consumed but has nowhere to go, since another cross-block edit collapsed the
		// selection first; an imported image, unlike text, isn't on the clipboard, so report it.
		if (!caret) {
			emitClipboardError(ctx.events, {
				error: new Error('cross-block paste resolved no caret; nothing inserted'),
				...(rangeStartPath ? { path: rangeStartPath } : {})
			});
			return;
		}

		// No `preDelete`: the delete above already removed the range and ran the join cleanup, so
		// handing the dispatch a range would delete a second time.
		const result = await pasteDispatch(
			{
				pastedText: pasted,
				targetPath: caret.path,
				offset: charOffsetOf(caret, 'cross-block-paste:dispatch')
			},
			{
				doc,
				blockEdit: ctx.blockEdit,
				controller: ctx.pasteCoordinator,
				crossBlock: true,
				reading: ctx.reading,
				activePlugins: ctx.activePlugins
			}
		);

		// A fix-up that merged the target into the block above moved the caret to a position this
		// gesture never mounted, so mount it before the placement looks for its element.
		if (result.inlineCaretPath) await ctx.revealPath(result.inlineCaretPath);
		await landCaretAfterPaste(ctx, result.inlineCaretPath ?? caret.path, result.inlineCaretOffset);
	});
	return true;
}

/** An inline paste places the caret through the DOM, since the pending caret may name a block the
 *  delete unmounted; a structural paste focuses itself, so this only catches focus leaving. */
async function landCaretAfterPaste(
	ctx: CrossBlockDispatchContext,
	caretPath: number[],
	inlineCaretOffset: number | undefined
): Promise<void> {
	await ctx.afterReactivity();
	if (inlineCaretOffset !== undefined) {
		focusCollapsedCaret(ctx.getBlockElByPath, { path: caretPath, offset: inlineCaretOffset });
		return;
	}
	const editorRoot = ctx.getEditorRoot();
	if (editorRoot && !editorRoot.contains(document.activeElement)) {
		ctx.getBlockElByPath(caretPath)?.focus();
	}
}

// ── Covered-block paste ────────────────────────────────────────────────────

/** The table a cell rectangle covers whole, or null. */
function wholeTablePath(selection: SelectionState, doc: Document): number[] | null {
	const anchor = selection.anchor;
	const focus = selection.focus;
	if (!anchor?.cellCoordinate || !focus?.cellCoordinate) return null;
	if (!pathsEqual(anchor.path, focus.path)) return null;
	const node = nodeAt(doc, anchor.path);
	if (!node || !countsCells(node)) return null;
	const cellCount = tableCellCount(node);
	if (cellCount === 0) return null;
	const lo = Math.min(anchor.offset, focus.offset);
	const hi = Math.max(anchor.offset, focus.offset);
	return lo === 0 && hi === cellCount - 1 ? anchor.path.slice() : null;
}

/** Through the paste coordinator, so the splice lands at the enclosing container's scope rather
 *  than the row-level `blockEdit` a table row passes down. */
async function replaceCoveredBlockWithPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	pasted: string,
	blockPath: number[]
): Promise<void> {
	const doc = ctx.getDoc();
	const covered = blockNodeAt(doc, blockPath);
	if (!covered) return;

	// This route skips `pasteDispatch`, so it applies the paste transforms and the instance
	// grammar itself.
	const parsed = parseReplacement(
		covered,
		applyPasteTransforms(pasted, ctx.activePlugins),
		documentLineEnding(doc),
		ctx.reading.grammar
	);
	if (!parsed) return;

	// Opened before the collapse, so the entry holds the range rather than the caret it leaves.
	await rangeUndoStep(mutCtx, async () => {
		ctx.selection.collapse();
		await ctx.pasteCoordinator.replaceBlock(
			blockPath,
			parsed.replacement,
			{ replacementIndex: parsed.replacement.length - 1, offset: CURSOR_END },
			// The block's whole position is the target, with nothing reattached after the pasted
			// text, so the trailing blank line comes in unfiltered.
			{ source: 'cross-block-covered-block', trailingBlank: parsed.suffix !== '' }
		);
	});
}
