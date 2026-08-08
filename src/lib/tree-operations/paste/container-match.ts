/**
 * Container-matching unwrap: when the clipboard's top block declares `containerPaste` and
 * a same-kind ancestor passes its `matchesAncestor` predicate, splice items into that
 * ancestor instead of nesting a sub-container.
 */

import { CURSOR_END } from '../../block-component';
import { metadataOf, type CstNode, type Document } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { nodeAt, restoreSeparatorAfterBlank, writeOwnRaw } from '../node-ops';
import { isBlankParagraph } from '../../core/parser';
import { containerPasteFor } from './container-paste';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { ensureUnsharedNode, ensureUnsharedPath, rebuildUnsharedChain } from '../unshare';
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { normalizeItemMarkerToList, renumberOrderedList } from '../list/ordered-markers';
import { orderedBaseOf, readOrderedSuffix } from '../list/list-builders';
import { spliceTerminatedItems } from '../list/terminator';
import type { PasteDispatchContext } from './dispatch';
import type { MultiScopeTarget } from './paste-deps';
import { docPathFrom } from '../../cursor/coordinate-spaces';

interface ContainerUnwrap {
	outerPath: number[];
	/** Index within outer.children of the target descendant. */
	spliceIndex: number;
	items: CstNode[];
	/**
	 * Non-empty-target variant: merge the first clipboard item into the target leaf, splice
	 * the rest as siblings, reattach post-caret residue to the last. Absent means the
	 * descendant is empty and gets replaced wholesale.
	 */
	merge?: {
		targetLeafPath: number[];
		offset: number;
	};
}

/**
 * Whether to flatten the paste into a matching ancestor container. Empty target
 * descendants always unwrap; non-empty ones only in cross-block context, so a single-block
 * paste into a partially-filled item keeps the nested-sub-container behavior.
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
	const containerPaste = containerPasteFor(topBlock.kind);
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

		// Merge-first / trailing-residue semantics are only well-defined for
		// single-paragraph first and last items.
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

/**
 * Template pasted items' bullet glyph to a matching unordered `list` ancestor, so a `*`
 * paste into a `- ` list serializes as one list to reference parsers, not two. Markers
 * are set before the splice (precompute-before-splice, see `list-absorb`).
 */
function normalizePastedListMarkers(items: CstNode[], outer: CstNode): void {
	if (outer.kind !== 'list' || metadataOf(outer, 'list')?.ordered) return;
	for (const item of items) normalizeItemMarkerToList(item, outer);
}

/**
 * Ordered counterpart of `normalizePastedListMarkers`: continue the ancestor's sequence
 * from `firstIndex`. Markers are set before the splice (precompute-before-splice, see
 * `list-absorb`); the caller renumbers the already-proxied tail afterward.
 */
function renumberPastedOrderedMarkers(items: CstNode[], outer: CstNode, firstIndex: number): void {
	if (outer.kind !== 'list' || !metadataOf(outer, 'list')?.ordered) return;
	const suffix = readOrderedSuffix(outer);
	const base = orderedBaseOf(outer.children?.[0]);
	items.forEach((item, i) => {
		const meta = metadataOf(item, 'listItem');
		if (!meta) return;
		meta.marker = String(base + firstIndex + i) + suffix;
		rebuildListItemRaw(item);
	});
}

export async function applyContainerMatchingPaste(
	unwrap: ContainerUnwrap,
	ctx: PasteDispatchContext
): Promise<void> {
	const outer = nodeAt(ctx.doc, unwrap.outerPath) as CstNode | null;
	if (!outer) return;
	const outerState = ctx.controller.resolveState(outer);
	if (!outerState) return;

	if (unwrap.merge) {
		await applyContainerMatchingMerge(unwrap, unwrap.merge, outer, outerState, ctx);
		return;
	}

	normalizePastedListMarkers(unwrap.items, outer);
	renumberPastedOrderedMarkers(unwrap.items, outer, unwrap.spliceIndex);
	// A blank target IS the separating line of the body block below it, so the splice consuming
	// it leaves both ends owed one (GH #73). An emptied post-delete stub separated nothing.
	const replaced = outer.children?.[unwrap.spliceIndex];
	const replacedBlank = replaced !== undefined && isBlankParagraph(replaced);

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot:
			ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(unwrap.outerPath), offset: 0 },
		mutate: ([scopeView]) => {
			spliceTerminatedItems(scopeView.children, unwrap.spliceIndex, 1, unwrap.items);
			const change: StructuralChange = {
				op: 'replace',
				at: unwrap.spliceIndex,
				count: 1,
				newCount: unwrap.items.length
			};
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			if (replacedBlank) {
				const parent = { children: scopeView.children, ownerKind: scopeView.node.kind };
				restoreSeparatorAfterBlank(parent, unwrap.spliceIndex, scopeView.sharing);
				const below = unwrap.spliceIndex + unwrap.items.length;
				restoreSeparatorAfterBlank(parent, below, scopeView.sharing);
			}
			// The already-proxied tail; the pasted items carry precomputed markers.
			renumberOrderedList(
				scopeView.node,
				unwrap.spliceIndex + unwrap.items.length,
				scopeView.sharing
			);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'container-matching', outerPath: unwrap.outerPath },
			eventPath: docPathFrom(unwrap.outerPath)
		},
		afterTick: () => {
			const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
			return ctx.controller.landCaret([...unwrap.outerPath, lastInsertedIdx], CURSOR_END);
		}
	});
}

/**
 * Non-empty-target path: merge the first item into the target leaf at the caret, splice
 * the rest as siblings, reattach post-caret residue to the last. A single-item clipboard
 * keeps everything in the target leaf.
 */
async function applyContainerMatchingMerge(
	unwrap: ContainerUnwrap,
	merge: NonNullable<ContainerUnwrap['merge']>,
	outer: CstNode,
	outerState: MultiScopeTarget['state'],
	ctx: PasteDispatchContext
): Promise<void> {
	const targetLeaf = nodeAt(ctx.doc, merge.targetLeafPath) as CstNode | null;
	if (!targetLeaf) return;

	const firstItem = unwrap.items[0];
	const firstLeaf = firstItem.children?.[0];
	if (!firstLeaf) return;

	const targetLineEnding = trailingLineEnding(targetLeaf.raw);
	const targetDisplay = trimTrailingLineEnding(targetLeaf.raw);
	const displayBefore = targetDisplay.slice(0, merge.offset);
	const displayAfter = targetDisplay.slice(merge.offset);
	const firstItemText = trimTrailingLineEnding(firstLeaf.raw);

	const remainingItems = unwrap.items.slice(1);
	// The first item merges into the target leaf, keeping its marker; only the trailing
	// siblings splice in, landing after the target.
	normalizePastedListMarkers(remainingItems, outer);
	renumberPastedOrderedMarkers(remainingItems, outer, unwrap.spliceIndex + 1);

	if (remainingItems.length === 0) {
		await ctx.controller.commitMultiScope({
			scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
			snapshot:
				ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(unwrap.outerPath), offset: 0 },
			mutate: ([scopeView]) => {
				const sharing = scopeView.sharing;
				// The merged leaf sits BELOW the scope node — own its full spine.
				const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
				const ownedLeaf = chain[chain.length - 1] ?? ensureUnsharedNode(targetLeaf, sharing);
				writeOwnRaw(
					ownedLeaf,
					displayBefore + firstItemText + displayAfter + targetLineEnding,
					ctx.grammar
				);
				rebuildUnsharedChain(ctx.doc, chain, sharing, ctx.grammar);
				return [{ op: 'noop' }];
			},
			op: {
				kind: 'paste',
				detail: { source: 'container-matching-merge-singleton', outerPath: unwrap.outerPath },
				eventPath: docPathFrom(unwrap.outerPath)
			},
			afterTick: () =>
				// A char offset inside the merged leaf, not a block index, so land on the leaf
				// itself: a container's focus(number) would clamp to its last child's end.
				ctx.controller.landCaret(merge.targetLeafPath, displayBefore.length + firstItemText.length)
		});
		return;
	}

	const lastItem = remainingItems[remainingItems.length - 1];
	// Guaranteed by `hasSingleParagraphChild` upstream; bailing here (before the commit)
	// keeps a drifting guard a clean no-op rather than a half-applied mutation.
	const lastLeaf = lastItem.children?.[0];
	if (!lastLeaf) return;
	const lastLineEnding = trailingLineEnding(lastLeaf.raw);
	const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot:
			ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(unwrap.outerPath), offset: 0 },
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			// The merged leaf sits BELOW the scope node — own its full spine.
			const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
			const ownedLeaf = chain[chain.length - 1] ?? ensureUnsharedNode(targetLeaf, sharing);
			writeOwnRaw(ownedLeaf, displayBefore + firstItemText + targetLineEnding, ctx.grammar);
			lastLeaf.raw = lastDisplay + displayAfter + lastLineEnding;
			// Both rebuilds run before the splice, so the published children carry correct
			// raws in one reactive flush.
			rebuildUnsharedChain(ctx.doc, chain, sharing, ctx.grammar);
			rebuildContainerRawIfContainer(remainingItems[remainingItems.length - 1]);

			// The siblings land after the merged target, which keeps its own slot.
			const insertAt = unwrap.spliceIndex + 1;
			const change: StructuralChange = {
				op: 'insert',
				at: insertAt,
				count: remainingItems.length
			};
			spliceTerminatedItems(scopeView.children, insertAt, 0, remainingItems);
			stampStructuralChange(scopeView.children, change, sharing);
			// The already-proxied tail below the spliced siblings; the merged target keeps
			// its number.
			renumberOrderedList(scopeView.node, insertAt + remainingItems.length, sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'container-matching-merge', outerPath: unwrap.outerPath },
			eventPath: docPathFrom(unwrap.outerPath)
		},
		afterTick: () => {
			// A char offset in the last spliced item's paragraph, so land on the paragraph
			// rather than CURSOR_END on the item.
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			return ctx.controller.landCaret(
				[...unwrap.outerPath, lastInsertedIdx, 0],
				lastDisplay.length
			);
		}
	});
}
