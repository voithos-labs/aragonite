/**
 * Container-matching unwrap: when the clipboard's top block is a container
 * kind declaring `containerPaste` and a same-kind ancestor passes its
 * `matchesAncestor` predicate, splice items into that ancestor instead of
 * nesting a sub-container.
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import { isProseKind, parseInline, getContentRange } from '../../core/inline';
import { trimTrailingLineEnding } from '../../core/lines';
import { nodeAt } from '../node-ops';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../unshare';
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { getStateForNode } from '../../reactivity/state-registry';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { spliceTerminatedItems } from '../list/terminator';
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
	const containerPaste = tryGetBlockKindDescriptor(topBlock.kind)?.containerPaste;
	if (!containerPaste) return null;
	if (!topBlock.children || topBlock.children.length === 0) return null;

	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = targetPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath) as CstNode | null;
		if (!ancestor) break;
		if (ancestor.kind !== topBlock.kind) continue;
		if (!containerPaste.matchesAncestor(topBlock, ancestor)) continue;

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
	if (!node.children || node.children.length === 0) return node.raw.trim() === '';
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

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot: ctx.undoEntry === 'join' ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
		mutate: ([scopeView]) => {
			spliceTerminatedItems(scopeView.children, unwrap.spliceIndex, 1, unwrap.items);
			const change: StructuralChange = {
				op: 'replace',
				at: unwrap.spliceIndex,
				count: 1,
				newCount: unwrap.items.length
			};
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'container-matching', outerPath: unwrap.outerPath },
			eventPath: unwrap.outerPath
		},
		afterTick: () => {
			const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
			outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
		}
	});
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
		await ctx.controller.commitMultiScope({
			scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
			snapshot: ctx.undoEntry === 'join' ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
			mutate: ([scopeView]) => {
				const sharing = scopeView.sharing;
				// The merged leaf sits BELOW the scope node — own its full spine.
				const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
				const ownedLeaf = chain[chain.length - 1] ?? targetLeaf;
				ownedLeaf.raw = displayBefore + firstItemText + displayAfter + targetLineEnding;
				if (isProseKind(ownedLeaf.kind)) {
					const range = getContentRange(ownedLeaf);
					ownedLeaf.inlineContent = parseInline(ownedLeaf.raw, range.start, range.end);
				}
				rebuildUnsharedChain(chain, sharing);
				return [{ op: 'noop' }];
			},
			op: {
				kind: 'paste',
				detail: { source: 'container-matching-merge-singleton', outerPath: unwrap.outerPath },
				eventPath: unwrap.outerPath
			},
			afterTick: () => {
				outerState.innerBlockRefs[unwrap.spliceIndex]?.focus(CURSOR_END);
			}
		});
		return;
	}

	const lastItem = remainingItems[remainingItems.length - 1];
	// findContainerMatchingUnwrap's hasSingleParagraphChild guard ensures this,
	// but a future refactor that updates one guard but not the other would
	// crash here — fail loudly instead of NPE-ing mid-commit.
	const lastLeaf = lastItem.children?.[0];
	if (!lastLeaf) return;
	const lastLineEnding = lastLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot: ctx.undoEntry === 'join' ? 'skip' : { blockIndex: unwrap.outerPath[0], offset: 0 },
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			// The merged leaf sits BELOW the scope node — own its full spine.
			// lastLeaf lives inside the parsed clipboard items (created, safe).
			const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
			const ownedLeaf = chain[chain.length - 1] ?? targetLeaf;
			ownedLeaf.raw = displayBefore + firstItemText + targetLineEnding;
			lastLeaf.raw = lastDisplay + displayAfter + lastLineEnding;
			if (isProseKind(ownedLeaf.kind)) {
				const range = getContentRange(ownedLeaf);
				ownedLeaf.inlineContent = parseInline(ownedLeaf.raw, range.start, range.end);
			}
			if (isProseKind(lastLeaf.kind)) {
				const range = getContentRange(lastLeaf);
				lastLeaf.inlineContent = parseInline(lastLeaf.raw, range.start, range.end);
			}
			// Rebuild target's ancestry so the enclosing listItem reflects the
			// merged paragraph before siblings splice in.
			rebuildUnsharedChain(chain, sharing);
			// Last remaining item's enclosing listItem raw still reflects the
			// pre-mutation paragraph; rebuild before splicing so the published
			// children carry correct raws in one reactive flush.
			rebuildContainerRawIfContainer(remainingItems[remainingItems.length - 1]);

			const change: StructuralChange = {
				op: 'insert',
				at: unwrap.spliceIndex + 1,
				count: remainingItems.length
			};
			spliceTerminatedItems(scopeView.children, unwrap.spliceIndex + 1, 0, remainingItems);
			stampStructuralChange(scopeView.children, change, sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'container-matching-merge', outerPath: unwrap.outerPath },
			eventPath: unwrap.outerPath
		},
		afterTick: () => {
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
		}
	});
}
