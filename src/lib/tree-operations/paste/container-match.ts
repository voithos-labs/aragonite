/**
 * Container-matching unwrap: when the clipboard is a list/blockquote of kind
 * K and an ancestor is also K (with matching ordered flag), splice items into
 * the matching ancestor instead of nesting a sub-container.
 */

import type { CstNode, Document } from '../../core/nodes';
import { CURSOR_END } from '../../contracts';
import { isProseKind, parseInline, getContentRange } from '../../core/inline';
import { trimTrailingLineEnding } from '../../core/lines';
import { nodeAt } from '../node-ops';
import { rebuildContainerRawIfContainer, rebuildAncestryRawForLeaf } from '../container-raw';
import { getStateForNode } from '../../state-registry';
import type { BlockListState } from '../../block-list-state.svelte';
import type { PasteDispatchContext } from './dispatch';

interface ContainerUnwrap {
	outerPath: number[];
	/** Index within outer.children of the target descendant. */
	spliceIndex: number;
	items: CstNode[];
	/**
	 * Non-empty-target variant: merge the first clipboard item's content
	 * into the target leaf at `offset`, splice the rest as siblings, and
	 * reattach post-caret residue to the last spliced item. Absent means
	 * the descendant is empty and gets replaced wholesale.
	 */
	merge?: {
		targetLeafPath: number[];
		offset: number;
	};
}

/**
 * Detect whether to flatten the paste into a matching ancestor container.
 * Empty target descendants always unwrap. Non-empty targets unwrap only in
 * cross-block context (post-range-delete), so single-block pastes into a
 * partially-filled item keep the nested-sub-container behavior.
 */
export function findContainerMatchingUnwrap(
	doc: Document,
	targetPath: number[],
	offset: number,
	parsed: Document,
	crossBlockContext: boolean
): ContainerUnwrap | null {
	if (parsed.children.length !== 1) return null;
	const topBlock = parsed.children[0];
	if (topBlock.kind !== 'list' && topBlock.kind !== 'blockquote') return null;
	if (!topBlock.children || topBlock.children.length === 0) return null;

	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = targetPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath) as CstNode | null;
		if (!ancestor) break;
		if (ancestor.kind !== topBlock.kind) continue;

		if (topBlock.kind === 'list') {
			const ancOrd = (ancestor.metadata as { ordered?: boolean } | undefined)?.ordered;
			const topOrd = (topBlock.metadata as { ordered?: boolean } | undefined)?.ordered;
			if (ancOrd !== topOrd) continue;
		}

		const spliceIndex = targetPath[depth];
		const targetChild = ancestor.children?.[spliceIndex];
		if (!targetChild) continue;

		if (isEmptyContainerChild(targetChild)) {
			return { outerPath: ancestorPath, spliceIndex, items: topBlock.children };
		}

		// Non-empty unwrap requires single-paragraph first/last items —
		// otherwise merge-first / trailing-residue semantics aren't well-defined.
		if (!crossBlockContext) return null;
		if (!hasSingleParagraphChild(topBlock.children[0])) return null;
		if (!hasSingleParagraphChild(topBlock.children[topBlock.children.length - 1])) return null;

		return {
			outerPath: ancestorPath,
			spliceIndex,
			items: topBlock.children,
			merge: { targetLeafPath: targetPath, offset }
		};
	}
	return null;
}

/** One leaf child whose raw has no visible content (post-cross-block-delete stub). */
function isEmptyContainerChild(node: CstNode): boolean {
	if (!node.children || node.children.length === 0) return true;
	if (node.children.length !== 1) return false;
	const c = node.children[0];
	if (c.kind !== 'paragraph') return false;
	return c.raw.trim() === '';
}

function hasSingleParagraphChild(node: CstNode): boolean {
	return !!node.children && node.children.length === 1 && node.children[0].kind === 'paragraph';
}

export async function applyContainerMatchingPaste(
	unwrap: ContainerUnwrap,
	ctx: PasteDispatchContext
): Promise<void> {
	const outer = nodeAt(ctx.doc, unwrap.outerPath) as CstNode | null;
	if (!outer) return;
	const outerState = getStateForNode(outer);
	if (!outerState) return;

	if (unwrap.merge) {
		await applyContainerMatchingMerge(unwrap, unwrap.merge, outer, outerState, ctx);
		return;
	}

	await ctx.controller.commitMultiScope(
		[{ node: outer, state: outerState }],
		ctx.skipSnapshot ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
		(scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(unwrap.spliceIndex, 1, ...unwrap.items);
			outer.children = children;
			const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
			rebuildAncestryRawForLeaf(ctx.doc, [...unwrap.outerPath, lastInsertedIdx]);
			return [{ op: 'replace', at: unwrap.spliceIndex, count: 1, newCount: unwrap.items.length }];
		},
		{
			kind: 'paste',
			detail: { source: 'container-matching', outerPath: unwrap.outerPath },
			eventPath: unwrap.outerPath
		},
		() => {
			const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
			outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
		}
	);
}

/**
 * Non-empty-target path: merge first item's content into the target leaf
 * at the caret, splice remaining items as siblings, reattach post-caret
 * residue to the last spliced item. Single-item clipboards keep everything
 * in the target leaf.
 */
async function applyContainerMatchingMerge(
	unwrap: ContainerUnwrap,
	merge: NonNullable<ContainerUnwrap['merge']>,
	outer: CstNode,
	outerState: BlockListState,
	ctx: PasteDispatchContext
): Promise<void> {
	const targetLeaf = nodeAt(ctx.doc, merge.targetLeafPath) as CstNode | null;
	if (!targetLeaf) return;

	const firstItem = unwrap.items[0];
	const firstLeaf = firstItem.children?.[0];
	if (!firstLeaf) return;

	const targetLineEnding = targetLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const targetDisplay = trimTrailingLineEnding(targetLeaf.raw);
	const displayBefore = targetDisplay.slice(0, merge.offset);
	const displayAfter = targetDisplay.slice(merge.offset);
	const firstItemText = trimTrailingLineEnding(firstLeaf.raw);

	const remainingItems = unwrap.items.slice(1);

	if (remainingItems.length === 0) {
		await ctx.controller.commitMultiScope(
			[{ node: outer, state: outerState }],
			ctx.skipSnapshot ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
			() => {
				targetLeaf.raw = displayBefore + firstItemText + displayAfter + targetLineEnding;
				if (isProseKind(targetLeaf.kind)) {
					const range = getContentRange(targetLeaf);
					targetLeaf.inlineContent = parseInline(targetLeaf.raw, range.start, range.end);
				}
				rebuildAncestryRawForLeaf(ctx.doc, merge.targetLeafPath);
				return [{ op: 'noop' }];
			},
			{
				kind: 'paste',
				detail: { source: 'container-matching-merge-singleton', outerPath: unwrap.outerPath },
				eventPath: unwrap.outerPath
			},
			() => {
				outerState.innerBlockRefs[unwrap.spliceIndex]?.focus(CURSOR_END);
			}
		);
		return;
	}

	const lastItem = remainingItems[remainingItems.length - 1];
	const lastLeaf = lastItem.children![0];
	const lastLineEnding = lastLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);

	await ctx.controller.commitMultiScope(
		[{ node: outer, state: outerState }],
		ctx.skipSnapshot ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
		(scopeChildren) => {
			targetLeaf.raw = displayBefore + firstItemText + targetLineEnding;
			lastLeaf.raw = lastDisplay + displayAfter + lastLineEnding;
			if (isProseKind(targetLeaf.kind)) {
				const range = getContentRange(targetLeaf);
				targetLeaf.inlineContent = parseInline(targetLeaf.raw, range.start, range.end);
			}
			if (isProseKind(lastLeaf.kind)) {
				const range = getContentRange(lastLeaf);
				lastLeaf.inlineContent = parseInline(lastLeaf.raw, range.start, range.end);
			}
			// Rebuild target's ancestry so the enclosing listItem reflects the
			// merged paragraph before siblings splice in.
			rebuildAncestryRawForLeaf(ctx.doc, merge.targetLeafPath);
			// Last remaining item's enclosing listItem raw still reflects the
			// pre-mutation paragraph; rebuild before splicing so the published
			// children carry correct raws in one reactive flush.
			rebuildContainerRawIfContainer(remainingItems[remainingItems.length - 1]);

			const children = scopeChildren[0].children;
			children.splice(unwrap.spliceIndex + 1, 0, ...remainingItems);
			outer.children = children;
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			rebuildAncestryRawForLeaf(ctx.doc, [...unwrap.outerPath, lastInsertedIdx, 0]);
			return [{ op: 'insert', at: unwrap.spliceIndex + 1, count: remainingItems.length }];
		},
		{
			kind: 'paste',
			detail: { source: 'container-matching-merge', outerPath: unwrap.outerPath },
			eventPath: unwrap.outerPath
		},
		() => {
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
		}
	);
}
