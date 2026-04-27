/**
 * Mutation routing for paste results — applies inline and structural results
 * produced by surface hooks to the document. Inline results route through
 * debounced updateBlockContent (or direct raw mutation for cross-block).
 * Structural results splice via replaceBlockAtParent, which resolves the
 * parent scope from the path itself rather than trusting `ctx.blockEdit` —
 * any caller passing a nested-bundle blockEdit (e.g., a row-level bundle
 * for a cell's path) would silently misroute through the wrong container.
 */

import type { CstNode } from '../../core/nodes';
import { isProseKind, parseInline, getContentRange } from '../../core/inline';
import { nodeAt } from '../node-ops';
import { rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext } from './dispatch';
import { replaceBlockAtParent } from './replace-block-at-parent';

/**
 * Apply an inline paste. Single-block routes through updateBlockContent
 * (snapshot + inline re-parse + kind-change focus); cross-block mutates raw
 * directly because the originating bundle may not match the target's level.
 *
 * Intentionally synchronous: the caller must set cursor state before the
 * first Svelte reactivity flush, so we return before any microtask boundary.
 */
export function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): void {
	if (ctx.skipSnapshot) {
		const targetNode = nodeAt(ctx.doc, targetPath) as CstNode | null;
		if (!targetNode) return;
		targetNode.raw = result.newRaw;
		if (isProseKind(targetNode.kind)) {
			const range = getContentRange(targetNode);
			targetNode.inlineContent = parseInline(targetNode.raw, range.start, range.end);
		}
		if (targetPath.length >= 2) {
			rebuildAncestryRawForLeaf(ctx.doc, targetPath);
		}
		return;
	}

	// Unawaited: the caller sets pendingCursorOffset in the same synchronous
	// block so both land in one reactive flush.
	const blockIndex = targetPath[targetPath.length - 1];
	ctx.blockEdit.updateBlockContent(blockIndex, result.newRaw, result.caretOffset);
}

export async function applyStructuralResult(
	targetPath: number[],
	result: StructuralPasteResult,
	ctx: PasteDispatchContext
): Promise<void> {
	await replaceBlockAtParent({
		doc: ctx.doc,
		blockPath: targetPath,
		replacement: result.replacement,
		controller: ctx.controller,
		skipSnapshot: ctx.skipSnapshot === true,
		focusReplacementIndex: result.focusReplacementIndex,
		focusOffset: result.focusOffset,
		source: 'paste-dispatch'
	});
}
