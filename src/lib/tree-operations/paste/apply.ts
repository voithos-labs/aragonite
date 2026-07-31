/** Applies the results a paste surface hook produced to the document. */

import { updateNodeContent } from '../node-ops';
import { ensureUnsharedChild } from '../unshare';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { stampStructuralChange } from '../structural-change';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext } from './dispatch';
import { resolveParentScope } from './parent-scope';
import { replaceBlockAtParent } from './replace-block-at-parent';

/**
 * Apply an inline paste. Single-block routes through `updateBlockContent`; cross-block
 * commits the same re-parse funnel directly against the parent scope, because the
 * originating bundle may not match the target's level. The single-block route stays
 * synchronous through its mutation so the caller can set cursor state before the first
 * reactivity flush.
 */
export async function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): Promise<void> {
	if (ctx.undoEntry === 'join') {
		await commitInlineJoin(targetPath, result, ctx);
		return;
	}

	// Unawaited: the caller sets pendingCursorOffset in the same synchronous block, so both
	// land in one reactive flush.
	const blockIndex = targetPath[targetPath.length - 1];
	void ctx.blockEdit.updateBlockContent(blockIndex, result.newRaw, result.caretOffset);
}

/**
 * Cross-block inline paste. `'join'` means the caller already pushed the covering
 * snapshot, not that the ceremony is skipped — committing is what keeps the parent's
 * `childIds` aligned and puts the insertion on the `edit` stream. The mutation routes
 * through the same-slot re-parse funnel, so a paste completing marker syntax re-mints the
 * slot at the reparsed kind instead of leaving the old kind holding foreign bytes.
 */
async function commitInlineJoin(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): Promise<void> {
	const scope = resolveParentScope(ctx.doc, targetPath, ctx.controller);
	if (!scope) return;
	const leafIndex = targetPath[targetPath.length - 1];

	await ctx.controller.commitMultiScope({
		scopes: [scope],
		snapshot: 'skip',
		mutate: ([view]) => {
			// The slot may still be snapshot-shared, and the funnel's same-kind branch writes
			// its raw in place (G1.9).
			ensureUnsharedChild(view, leafIndex, view.sharing);
			const change = updateNodeContent(
				{ children: view.children, ownerKind: view.node.kind },
				leafIndex,
				result.newRaw,
				ctx.grammar
			);
			stampStructuralChange(view.children, change, view.sharing);
			return [change];
		},
		op: {
			kind: 'updateContent',
			detail: { length: result.newRaw.length },
			eventPath: docPathFrom(targetPath)
		}
	});
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
