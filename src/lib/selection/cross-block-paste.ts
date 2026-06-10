/**
 * Cross-block paste: delete the active range inside a single undo snapshot,
 * dispatch the paste onto the collapsed caret, then restore the caret via
 * DOM (the originating block may have been removed, invalidating pendingCursor).
 */

import type { CrossBlockDispatchContext } from './cross-block-dispatch';
import type { CrossBlockMutationContext } from './cross-block-ops';
import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionState } from './selection-state.svelte';
import { normalizeLineEndings } from '../core/lines';
import { performCrossBlockDelete } from './cross-block-ops';
import { assertCharOffset } from './primitives';
import { applyCollapsedCaret } from './native-bridge';
import { pasteDispatch } from '../tree-operations/paste/dispatch';
import { parse } from '../core/parser';
import { nodeAt } from '../tree-operations/node-ops';
import { pathsEqual } from './path-math';
import { materializeBlankLines } from '../tree-operations/paste/strategy';
import { replaceBlockAtParent } from '../tree-operations/paste/replace-block-at-parent';
import { ensureEditableContainers, normalizeReplacementTrivia } from '../tree-operations';
import { parseAllInlineContent } from '../core/inline';

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
		skipSnapshot: true,
		skipCaretRestore: true
	});
	if (!caret) return true;

	const result = await pasteDispatch(
		{
			pastedText: pasted,
			targetPath: caret.path,
			offset: assertCharOffset(caret, 'cross-block-paste:dispatch')
		},
		{
			doc,
			blockEdit: ctx.blockEdit,
			controller: ctx.pasteCoordinator,
			skipSnapshot: true
		}
	);

	// Place the caret via DOM rather than pendingCursor — the originating
	// block may have been removed by the cross-block delete, leaving a
	// pendingCursor write addressed to an unmounted component.
	if (result.inlineCaretOffset !== undefined) {
		await ctx.afterReactivity();
		const inlineEl = ctx.getBlockElByPath(caret.path);
		if (inlineEl) {
			applyCollapsedCaret(inlineEl, {
				path: caret.path,
				offset: result.inlineCaretOffset
			});
			inlineEl.focus();
		}
		return true;
	}

	// Structural paste: pasteDispatch's internal afterTick focuses the last
	// spliced block via its parent state. If cascade cleanup destroyed that
	// parent state, the focus silently no-ops. Detect by checking whether
	// focus landed in the editor; if not, DOM-focus caret.path (post-paste)
	// as a fallback so the user isn't left without a caret.
	await ctx.afterReactivity();
	const editorRoot = ctx.getEditorRoot();
	if (editorRoot && !editorRoot.contains(document.activeElement)) {
		const fallbackEl = ctx.getBlockElByPath(caret.path);
		fallbackEl?.focus();
	}
	return true;
}

// ── Whole-table paste ──────────────────────────────────────────────────────

function isWholeTableSelection(selection: SelectionState, doc: Document): boolean {
	const anchor = selection.anchor;
	const focus = selection.focus;
	if (!anchor || !focus) return false;
	if (!pathsEqual(anchor.path, focus.path)) return false;
	const node = nodeAt(doc, anchor.path);
	if (!node || node.kind !== 'table') return false;
	const meta = metadataOf(node, 'table');
	const rowCount = node.children?.length ?? 0;
	const cellCount = meta.columnCount * rowCount;
	if (cellCount === 0) return false;
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

	const parsed = parse(pasted);
	if (parsed.children.length === 0) return;
	const blocks = materializeBlankLines(parsed.children);

	const tableNode = nodeAt(doc, tablePath) as CstNode | null;
	if (!tableNode) return;
	const replacement = normalizeReplacementTrivia(tableNode, blocks);
	for (const node of replacement) ensureEditableContainers(node);
	parseAllInlineContent(replacement);

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await replaceBlockAtParent({
		doc,
		blockPath: tablePath,
		replacement,
		controller: ctx.pasteCoordinator,
		skipSnapshot: true,
		focusReplacementIndex: replacement.length - 1,
		focusOffset: Number.MAX_SAFE_INTEGER,
		source: 'cross-block-paste-whole-table'
	});
}
