/**
 * Cross-block paste: delete the active range inside a single undo snapshot, dispatch the paste
 * onto the collapsed caret, then restore the caret via DOM, since the originating block may be
 * gone and pendingCursor with it.
 */

import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import type { Document } from '../../core/nodes';
import type { SelectionState } from '../selection-state.svelte';
import { tableCellCount } from '../table-endpoint-snap';
import { CURSOR_END } from '../../block-component';
import { documentLineEnding, normalizeLineEndings } from '../../core/lines';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { focusCollapsedCaret } from '../native-bridge';
import { blockCoveredWhole } from '../covered-block';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { blockNodeAt, isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { pathsEqual } from '../path-math';
import { replaceBlockAtParent } from '../../tree-operations/paste/replace-block-at-parent';
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

	// One snapshot covers the whole delete-then-paste so Ctrl+Z doesn't leave an intermediate
	// "selection-deleted but blocks-not-inserted" state.
	mutCtx.pushUndoSnapshot();

	const caret = await performCrossBlockDelete(mutCtx, {
		undoEntry: 'join',
		skipCaretRestore: true
	});
	// The gesture was consumed (preventDefault above) and there is nowhere to put the payload:
	// another cross-block mutation collapsed the selection while this paste waited it out. Text
	// survives on the clipboard, but a host-imported image does not, so report it.
	if (!caret) {
		emitClipboardError(ctx.events, {
			error: new Error('cross-block paste resolved no caret; nothing inserted'),
			...(rangeStartPath ? { path: rangeStartPath } : {})
		});
		return true;
	}

	// No `preDelete`: the range is already gone. `performCrossBlockDelete` above took it through
	// `rangeDelete`, which runs the join cleanup itself, so this dispatch inserts at a caret the
	// cleanup already placed; handing it a range would delete a second time.
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
			undoEntry: 'join',
			reading: ctx.reading,
			activePlugins: ctx.activePlugins
		}
	);

	// A fix-up that merged the target into the block above moved the caret to a position this
	// gesture never mounted, so mount it before the placement looks for its element.
	if (result.inlineCaretPath) await ctx.revealPath(result.inlineCaretPath);
	await landCaretAfterPaste(ctx, result.inlineCaretPath ?? caret.path, result.inlineCaretOffset);
	return true;
}

/**
 * Land the caret after a cross-block paste commit. Inline pastes place it via DOM, since
 * pendingCursor may address a block the range delete unmounted; structural pastes rely on
 * pasteDispatch's internal focus and only step in when focus escaped the editor.
 */
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

/** The table a cell rectangle covers whole (a second Ctrl+A inside a cell), or null. */
function wholeTablePath(selection: SelectionState, doc: Document): number[] | null {
	const anchor = selection.anchor;
	const focus = selection.focus;
	if (!anchor || !focus) return null;
	if (!pathsEqual(anchor.path, focus.path)) return null;
	const node = nodeAt(doc, anchor.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return null;
	const cellCount = tableCellCount(node);
	if (cellCount === 0) return null;
	// A selection inside one table: the offsets are cell indices, read directly.
	const lo = Math.min(anchor.offset, focus.offset);
	const hi = Math.max(anchor.offset, focus.offset);
	return lo === 0 && hi === cellCount - 1 ? anchor.path.slice() : null;
}

/**
 * Replace the covered block with the pasted content at its parent position. Routes through
 * replaceBlockAtParent so the splice lands at the doc/enclosing-container scope rather than the
 * row-level blockEdit TableRowBlock propagates. One snapshot covers the replace.
 */
async function replaceCoveredBlockWithPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	pasted: string,
	blockPath: number[]
): Promise<void> {
	const doc = ctx.getDoc();
	const covered = blockNodeAt(doc, blockPath);
	if (!covered) return;

	// This route never reaches pasteDispatch, so the paste transforms and the instance grammar
	// ride here too; both rules live in the helper, applied at both sites.
	const parsed = parseReplacement(
		covered,
		applyPasteTransforms(pasted, ctx.activePlugins),
		documentLineEnding(doc),
		ctx.reading.grammar
	);
	if (!parsed) return;

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await replaceBlockAtParent({
		doc,
		blockPath,
		replacement: parsed.replacement,
		controller: ctx.pasteCoordinator,
		undoEntry: 'join',
		focusReplacementIndex: parsed.replacement.length - 1,
		focusOffset: CURSOR_END,
		source: 'cross-block-covered-block',
		grammar: ctx.reading.grammar,
		// Nothing is reattached after the pasted text here, since the block's whole position is
		// the target, so the trailing blank line comes in unfiltered (`paste/dispatch.ts` states
		// the rule).
		trailingSeparator: parsed.suffix
	});
}
