/** Applies the results a paste surface hook produced to the document. */

import { settledCaretTarget, updateNodeContent, type SettledContent } from '../content-write';
import { ensureUnsharedChild } from '../unshare';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { stampStructuralChange } from '../structural-change';
import type { CstNode } from '../../core/nodes';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext, InlineCaretLanding } from './dispatch';
import { resolveParentScope } from './parent-scope';
import { replaceBlockAtParent } from './replace-block-at-parent';

/**
 * Apply an inline paste. Single-block goes through `updateBlockContent`; cross-block runs the
 * same reparse path directly against the parent list, because the originating action bundle
 * may not match the target's level. The single-block route stays synchronous through its
 * mutation so the caller can set cursor state before the first reactivity flush.
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
 * Cross-block inline paste. `'join'` means the caller already pushed the undo snapshot; the
 * commit still runs, to keep the parent's `childIds` aligned and report the edit. The write goes
 * through the reparse path, so a paste that completes marker syntax changes the block's kind.
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
			// The node may still be snapshot-shared, and the same-kind branch of the reparse
			// writes its raw in place (G1.9).
			ensureUnsharedChild(view, leafIndex, view.sharing);
			settled = updateNodeContent(
				{ children: view.children, ownerKind: view.node.kind, owner: view.node },
				leafIndex,
				result.newRaw,
				ctx.reading.grammar,
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

	// The paste can demote the block's kind, and a merge into the block above left that block
	// holding the pasted bytes, so the caller's own caret target is stale.
	const target = settledCaretTarget(settled, leafIndex, result.caretOffset, siblings);
	return {
		path: [...targetPath.slice(0, -1), target.index, ...target.path],
		offset: target.offset
	};
}

export async function applyStructuralResult(
	targetPath: number[],
	result: StructuralPasteResult,
	ctx: PasteDispatchContext,
	trailingSeparator = ''
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
		trailingSeparator,
		grammar: ctx.reading.grammar
	});
}
