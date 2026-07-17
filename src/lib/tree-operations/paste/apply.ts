/**
 * Applies the results a paste surface hook produced to the document.
 *
 * Structural results splice via replaceBlockAtParent, which resolves the parent
 * scope from the path itself rather than trusting `ctx.blockEdit` — a caller
 * passing a nested-bundle blockEdit (e.g. a row-level bundle for a cell's path)
 * would silently misroute through the wrong container.
 */

import { ensureUnsharedPath, rebuildUnsharedChain } from '../unshare';
import { updateNodeContent } from '../node-ops';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext } from './dispatch';
import { replaceBlockAtParent } from './replace-block-at-parent';

/**
 * Apply an inline paste. Single-block routes through updateBlockContent
 * (snapshot + inline re-parse + kind-change focus); cross-block runs the same
 * re-parse funnel directly on the owned chain because the originating bundle may
 * not match the target's level, so it can't borrow the target's updateBlockContent.
 *
 * Intentionally synchronous: the caller must set cursor state before the
 * first Svelte reactivity flush, so we return before any microtask boundary.
 */
export function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): void {
	if (ctx.undoEntry === 'join') {
		// Out-of-ceremony write — the caller pushed the covering snapshot, so
		// copy-path-on-write happens here.
		const chain = ensureUnsharedPath(ctx.doc, targetPath, ctx.controller.sharing);
		if (chain.length !== targetPath.length) return;
		// Route through the same-slot re-parse funnel, not a raw-only write: a join
		// that completes marker syntax (`1` before `. item`) must re-mint the slot at
		// the reparsed kind — a bare raw write leaves the old kind holding foreign
		// bytes and parse(serialize(live)) diverges. Mirrors the non-join sibling,
		// which routes through updateBlockContent → the funnel.
		const leafIndex = targetPath[targetPath.length - 1];
		const parentNode = chain.length >= 2 ? chain[chain.length - 2] : ctx.doc;
		updateNodeContent({ children: parentNode.children ?? [] }, leafIndex, result.newRaw);
		rebuildUnsharedChain(chain, ctx.controller.sharing);
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
		undoEntry: ctx.undoEntry ?? 'own',
		focusReplacementIndex: result.focusReplacementIndex,
		focusOffset: result.focusOffset,
		source: 'paste-dispatch'
	});
}
