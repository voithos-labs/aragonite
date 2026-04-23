/**
 * Mutation routing for paste results — applies inline and structural results
 * produced by surface hooks to the document, choosing between debounced
 * updateBlockContent, top-level replaceBlock, and nested commitMultiScope.
 */

import type { CstNode } from '../../core/nodes';
import { isProseKind, parseInline, getContentRange } from '../../core/inline';
import { nodeAt } from '../node-ops';
import { rebuildAncestryRawForLeaf } from '../container-raw';
import { expectStateForNode } from '../../state-registry';
import type { InlinePasteResult, StructuralPasteResult } from '../paste-surfaces';
import type { PasteDispatchContext } from './dispatch';

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
	if (targetPath.length === 1) {
		const index = targetPath[0];
		await ctx.blockEdit.replaceBlock(
			index,
			result.replacement,
			{
				replacementIndex: result.focusReplacementIndex,
				offset: result.focusOffset
			},
			{ skipSnapshot: ctx.skipSnapshot }
		);
		return;
	}

	const parentPath = targetPath.slice(0, -1);
	const parent = nodeAt(ctx.doc, parentPath) as CstNode | null;
	const innerIndex = targetPath[targetPath.length - 1];
	if (!parent?.children || innerIndex < 0 || innerIndex >= parent.children.length) return;

	const parentState = expectStateForNode(parent);

	await ctx.controller.commitMultiScope(
		[{ node: parent, state: parentState }],
		ctx.skipSnapshot ? 'skip' : { blockIndex: targetPath[0], offset: 0 },
		(scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(innerIndex, 1, ...result.replacement);
			// Sync before rebuild — rebuildAncestryForLeaf reads node.children directly.
			parent.children = children;
			rebuildAncestryRawForLeaf(ctx.doc, [...parentPath, innerIndex]);
			return [
				{
					op: 'replace',
					at: innerIndex,
					count: 1,
					newCount: result.replacement.length
				}
			];
		},
		{
			kind: 'replaceBlock',
			detail: { source: 'paste-dispatch', path: targetPath },
			eventPath: targetPath
		},
		() => {
			const lastIdx = innerIndex + result.focusReplacementIndex;
			parentState.innerBlockRefs[lastIdx]?.focus(result.focusOffset);
		}
	);
}
