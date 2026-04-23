/**
 * Cross-block paste: delete the active range inside a single undo snapshot,
 * dispatch the paste onto the collapsed caret, then restore the caret via
 * DOM (the originating block may have been removed, invalidating pendingCursor).
 */

import type { CrossBlockDispatchContext } from './cross-block-dispatch';
import type { CrossBlockMutationContext } from './cross-block-ops';
import { normalizeLineEndings } from '../core/lines';
import { performCrossBlockDelete } from './cross-block-ops';
import { applyCollapsedCaret } from './native-bridge';
import { pasteDispatch } from '../tree-operations/paste/dispatch';

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

	// One snapshot covers the whole delete-then-paste so Ctrl+Z doesn't leave
	// an intermediate "selection-deleted but blocks-not-inserted" state.
	mutCtx.pushUndoSnapshot();

	const doc = ctx.getDoc();
	const caret = await performCrossBlockDelete(mutCtx, {
		skipSnapshot: true,
		skipCaretRestore: true
	});
	if (!caret) return true;

	const result = await pasteDispatch(
		{
			pastedText: pasted,
			targetPath: caret.path,
			offset: caret.offset
		},
		{
			doc,
			blockEdit: ctx.blockEdit,
			controller: ctx.controller,
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
