/**
 * Cross-block paste: delete the active range inside a single undo snapshot,
 * dispatch the paste onto the collapsed caret, then restore the caret via
 * DOM (the originating block may have been removed, invalidating pendingCursor).
 */

import type { CrossBlockDispatchContext } from './dispatch';
import type { CrossBlockMutationContext } from './ops';
import type { Document } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import type { SelectionState } from '../selection-state.svelte';
import { normalizeLineEndings } from '../../core/lines';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { applyCollapsedCaret } from '../native-bridge';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { parse } from '../../core/parser';
import { blockNodeAt, isBlockNode, nodeAt } from '../../tree-operations/node-ops';
import { pathsEqual } from '../path-math';
import { materializeBlankLines } from '../../tree-operations/paste/strategy';
import { replaceBlockAtParent } from '../../tree-operations/paste/replace-block-at-parent';
import { ensureEditableContainers, normalizeReplacementTrivia } from '../../tree-operations';

export async function handleCrossBlockPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: ClipboardEvent
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock) return false;

	ctx.stickyColumn.reset();
	ctx.selection.resetSelectAllCount();
	e.preventDefault();
	const pasted = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
	if (!pasted) return true;

	const doc = ctx.getDoc();

	// Whole-table selection (Ctrl+A 2nd press inside a cell): replace the table
	// block with the pasted content at the parent position, single undo. The
	// sub-rectangle path can't reach this — clearing every cell leaves the
	// table behind, but the spec calls for the table to be removed entirely.
	if (isWholeTableSelection(ctx.selection, doc)) {
		await replaceTableWithPaste(ctx, mutCtx, pasted);
		return true;
	}

	// One snapshot covers the whole delete-then-paste so Ctrl+Z doesn't leave
	// an intermediate "selection-deleted but blocks-not-inserted" state.
	mutCtx.pushUndoSnapshot();

	const caret = await performCrossBlockDelete(mutCtx, {
		undoEntry: 'join',
		skipCaretRestore: true
	});
	if (!caret) return true;

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
			undoEntry: 'join'
		}
	);

	await landCaretAfterPaste(ctx, caret.path, result.inlineCaretOffset);
	return true;
}

/**
 * Land the caret after a cross-block paste commit. Inline pastes place the
 * caret via DOM (pendingCursor may address a block the range delete
 * unmounted); structural pastes rely on pasteDispatch's internal focus and
 * only DOM-focus the caret block if focus escaped the editor (cascade
 * cleanup can destroy the parent state the internal focus targets).
 */
async function landCaretAfterPaste(
	ctx: CrossBlockDispatchContext,
	caretPath: number[],
	inlineCaretOffset: number | undefined
): Promise<void> {
	await ctx.afterReactivity();
	if (inlineCaretOffset !== undefined) {
		const el = ctx.getBlockElByPath(caretPath);
		if (el) {
			applyCollapsedCaret(el, { path: caretPath, offset: inlineCaretOffset });
			el.focus();
		}
		return;
	}
	const editorRoot = ctx.getEditorRoot();
	if (editorRoot && !editorRoot.contains(document.activeElement)) {
		ctx.getBlockElByPath(caretPath)?.focus();
	}
}

// ── Whole-table paste ──────────────────────────────────────────────────────

function isWholeTableSelection(selection: SelectionState, doc: Document): boolean {
	const anchor = selection.anchor;
	const focus = selection.focus;
	if (!anchor || !focus) return false;
	if (!pathsEqual(anchor.path, focus.path)) return false;
	const node = nodeAt(doc, anchor.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return false;
	const meta = metadataOf(node, 'table');
	const rowCount = node.children?.length ?? 0;
	const cellCount = meta.columnCount * rowCount;
	if (cellCount === 0) return false;
	// Same-path intra-table selection: cell offsets are context-established
	// (same table, unflagged), so read directly.
	const lo = Math.min(anchor.offset, focus.offset);
	const hi = Math.max(anchor.offset, focus.offset);
	return lo === 0 && hi === cellCount - 1;
}

/**
 * Replace the selected table block with the pasted content at the table's
 * parent position. Routes through replaceBlockAtParent so the splice lands at
 * the doc/enclosing-container scope rather than the row-level blockEdit
 * propagated by TableRowBlock. One snapshot covers the whole replace — Ctrl+Z
 * restores the original table in a single press.
 */
async function replaceTableWithPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	pasted: string
): Promise<void> {
	const tablePath = ctx.selection.anchor!.path;
	const doc = ctx.getDoc();

	// This whole-table-selection route never reaches pasteDispatch, so the paste
	// transforms run here too — the rule lives in the helper, applied at both sites.
	const parsed = parse(applyPasteTransforms(pasted));
	if (parsed.children.length === 0) return;
	const blocks = materializeBlankLines(parsed.children);

	const tableNode = blockNodeAt(doc, tablePath);
	if (!tableNode) return;
	const replacement = normalizeReplacementTrivia(tableNode, blocks);
	for (const node of replacement) ensureEditableContainers(node);

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await replaceBlockAtParent({
		doc,
		blockPath: tablePath,
		replacement,
		controller: ctx.pasteCoordinator,
		undoEntry: 'join',
		focusReplacementIndex: replacement.length - 1,
		focusOffset: Number.MAX_SAFE_INTEGER,
		source: 'cross-block-paste-whole-table'
	});
}
