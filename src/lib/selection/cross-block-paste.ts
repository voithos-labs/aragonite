/**
 * Cross-block paste: delete the active range inside a single undo snapshot,
 * dispatch the paste onto the collapsed caret, then restore the caret via
 * DOM (the originating block may have been removed, invalidating pendingCursor).
 */

import type { CrossBlockDispatchContext } from './cross-block-dispatch';
import type { CrossBlockMutationContext } from './cross-block-ops';
import type { CstNode, Document, TableMetadata } from '../core/nodes';
import type { SelectionState } from './selection-state.svelte';
import { normalizeLineEndings } from '../core/lines';
import { performCrossBlockDelete } from './cross-block-ops';
import { applyCollapsedCaret } from './native-bridge';
import { pasteDispatch } from '../tree-operations/paste/dispatch';
import { parse } from '../core/parser';
import { nodeAt } from '../tree-operations/node-ops';
import { pathsEqual } from './path-math';
import { materializeBlankLines } from '../tree-operations/paste/strategy';
import { rebuildAncestryRawForLeaf } from '../schema/container-raw';
import { expectStateForNode } from '../reactivity/state-registry';
import {
	ensureEditableContainers,
	normalizeReplacementTrivia
} from '../tree-operations';
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
			offset: caret.offset
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
	const meta = node.metadata as TableMetadata;
	const rowCount = node.children?.length ?? 0;
	const cellCount = meta.columnCount * rowCount;
	if (cellCount === 0) return false;
	const lo = Math.min(anchor.offset, focus.offset);
	const hi = Math.max(anchor.offset, focus.offset);
	return lo === 0 && hi === cellCount - 1;
}

/**
 * Replace the selected table block with the pasted content at the table's
 * parent position. Splices via commitMultiScope rooted at the table's parent
 * (doc-scope when the table is top-level, the enclosing container's state
 * otherwise), so the row-level blockEdit propagated by TableRowBlock is
 * sidestepped. One snapshot covers the whole replace — Ctrl+Z restores the
 * original table in a single press.
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

	const parentPath = tablePath.slice(0, -1);
	const tableIndex = tablePath[tablePath.length - 1];

	const isTopLevel = parentPath.length === 0;
	const parentNode = isTopLevel ? null : (nodeAt(doc, parentPath) as CstNode | null);
	if (!isTopLevel && (!parentNode || !parentNode.children)) return;

	const tableNode = isTopLevel ? doc.children[tableIndex] : parentNode!.children![tableIndex];
	if (!tableNode) return;
	const replacement = normalizeReplacementTrivia(tableNode, blocks);
	for (const node of replacement) ensureEditableContainers(node);
	parseAllInlineContent(replacement);

	const scope = isTopLevel
		? ctx.pasteCoordinator.getDocScope()
		: { node: parentNode!, state: expectStateForNode(parentNode!) };

	mutCtx.pushUndoSnapshot();
	ctx.selection.collapse();

	await ctx.pasteCoordinator.commitMultiScope({
		scopes: [scope],
		snapshot: 'skip',
		mutate: (scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(tableIndex, 1, ...replacement);
			if (!isTopLevel) {
				parentNode!.children = children;
				rebuildAncestryRawForLeaf(doc, [...parentPath, tableIndex]);
			}
			return [
				{
					op: 'replace',
					at: tableIndex,
					count: 1,
					newCount: replacement.length
				}
			];
		},
		op: {
			kind: 'replaceBlock',
			detail: { source: 'cross-block-paste-whole-table' },
			eventPath: tablePath
		},
		afterTick: () => {
			const lastIdx = tableIndex + replacement.length - 1;
			scope.state.innerBlockRefs[lastIdx]?.focus(Number.MAX_SAFE_INTEGER);
		}
	});
}
