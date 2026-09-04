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
import { normalizeLineEndings } from '../../core/lines';
import { performCrossBlockDelete } from './ops';
import { charOffsetOf } from '../primitives';
import { focusCollapsedCaret } from '../native-bridge';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { parse } from '../../core/parser';
import { blockNodeAt, isBlockNode, nodeAt } from '../../tree-operations/node-ops';
import { pathsEqual } from '../path-math';
import { replaceBlockAtParent } from '../../tree-operations/paste/replace-block-at-parent';
import { ensureEditableContainers, normalizeReplacementTrivia } from '../../tree-operations';
import { emitClipboardError } from '../../editor-events';

export async function handleCrossBlockPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: ClipboardEvent | null,
	replacement?: string
): Promise<boolean> {
	if (!ctx.selection.isCrossBlock) return false;

	ctx.stickyColumn.reset();
	ctx.edgeAffinity.reset();
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

	// Whole-table selection (Ctrl+A 2nd press inside a cell): replace the table block at the
	// parent position, single undo. The sub-rectangle path only clears cells, leaving the table.
	if (isWholeTableSelection(ctx.selection, doc)) {
		await replaceTableWithPaste(ctx, mutCtx, pasted);
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
	// `rangeDelete`, which crosses the join seam itself, so this dispatch inserts at a caret the
	// cleanup already seated — handing it a range would delete a second time.
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
			grammar: ctx.grammar,
			activePlugins: ctx.activePlugins
		}
	);

	// A settle that absorbed the join above the target moved the caret to a slot this gesture
	// never revealed, so mount it before the landing reads for its element.
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

// ── Whole-table paste ──────────────────────────────────────────────────────

function isWholeTableSelection(selection: SelectionState, doc: Document): boolean {
	const anchor = selection.anchor;
	const focus = selection.focus;
	if (!anchor || !focus) return false;
	if (!pathsEqual(anchor.path, focus.path)) return false;
	const node = nodeAt(doc, anchor.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return false;
	const cellCount = tableCellCount(node);
	if (cellCount === 0) return false;
	// Same-path intra-table selection: cell offsets are context-established, so read directly.
	const lo = Math.min(anchor.offset, focus.offset);
	const hi = Math.max(anchor.offset, focus.offset);
	return lo === 0 && hi === cellCount - 1;
}

/**
 * Replace the selected table block with the pasted content at the table's parent position.
 * Routes through replaceBlockAtParent so the splice lands at the doc/enclosing-container scope
 * rather than the row-level blockEdit TableRowBlock propagates. One snapshot covers the replace.
 */
async function replaceTableWithPaste(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	pasted: string
): Promise<void> {
	const tablePath = ctx.selection.anchor!.path;
	const doc = ctx.getDoc();

	// This route never reaches pasteDispatch, so the paste transforms run here too; the rule
	// lives in the helper, applied at both sites.
	const parsed = parse(applyPasteTransforms(pasted, ctx.activePlugins), { scope: 'fragment' });
	if (parsed.children.length === 0) return;

	const tableNode = blockNodeAt(doc, tablePath);
	if (!tableNode) return;
	const replacement = normalizeReplacementTrivia(tableNode, parsed.children);
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
		focusOffset: CURSOR_END,
		source: 'cross-block-paste-whole-table',
		// Nothing is reattached behind the clipboard here — the table's whole slot is the target —
		// so the trailing blank rides in unfiltered (`paste/dispatch.ts` states the rule).
		trailingSeparator: parsed.suffix
	});
}
