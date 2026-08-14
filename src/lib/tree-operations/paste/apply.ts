/** Applies the results a paste surface hook produced to the document. */

import { settledCaretTarget, updateNodeContent, type SettledContent } from '../node-ops';
import { ensureUnsharedChild } from '../unshare';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { stampStructuralChange } from '../structural-change';
import type { CstNode } from '../../core/nodes';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext, InlineCaretLanding } from './dispatch';
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
): Promise<InlineCaretLanding | undefined> {
	if (ctx.undoEntry === 'join') {
		return commitInlineJoin(targetPath, result, ctx);
	}

	// Unawaited: the caller sets pendingCursorOffset in the same synchronous block, so both
	// land in one reactive flush.
	const blockIndex = targetPath[targetPath.length - 1];
	void ctx.blockEdit.updateBlockContent(blockIndex, result.newRaw, result.caretOffset);
	return undefined;
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
): Promise<InlineCaretLanding | undefined> {
	const scope = resolveParentScope(ctx.doc, targetPath, ctx.controller);
	if (!scope) return undefined;
	const leafIndex = targetPath[targetPath.length - 1];
	let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
	let siblings: readonly CstNode[] = [];

	await ctx.controller.commitMultiScope({
		scopes: [scope],
		snapshot: 'skip',
		mutate: ([view]) => {
			// The slot may still be snapshot-shared, and the funnel's same-kind branch writes
			// its raw in place (G1.9).
			ensureUnsharedChild(view, leafIndex, view.sharing);
			settled = updateNodeContent(
				{ children: view.children, ownerKind: view.node.kind, owner: view.node },
				leafIndex,
				result.newRaw,
				ctx.grammar,
				view.sharing
			);
			siblings = view.children;
			stampStructuralChange(view.children, settled.change, view.sharing);
			return [settled.change];
		},
		op: {
			kind: 'updateContent',
			detail: { length: result.newRaw.length },
			eventPath: docPathFrom(targetPath)
		}
	});

	// The paste can demote the slot's kind, and a settle that absorbed the join above it left
	// the predecessor holding the pasted bytes — so the caller's own caret target is stale.
	const target = settledCaretTarget(settled, leafIndex, result.caretOffset, siblings);
	return { path: [...targetPath.slice(0, -1), target.index], offset: target.offset };
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
		source: 'paste-dispatch',
		...(ctx.grammar ? { grammar: ctx.grammar } : {})
	});
}
