/**
 * Container-matching unwrap: when the clipboard's top block declares `containerPaste` and
 * a same-kind ancestor passes its `matchesAncestor` predicate, splice items into that
 * ancestor instead of nesting a sub-container.
 */

import { CURSOR_END } from '../../block-component';
import { devWarn } from '../../dev-warn';
import { metadataOf, type CstNode, type Document } from '../../core/nodes';
import { trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import {
	nodeAt,
	settledCaretTarget,
	updateNodeContent,
	writeOwnRaw,
	type SettledContent
} from '../node-ops';
import { containerPasteFor } from './container-paste';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { ensureUnsharedNode, ensureUnsharedPath, rebuildUnsharedChain } from '../unshare';
import { containerScopeState } from './parent-scope';
import {
	applyStructuralChangeToIdsRefs,
	stampStructuralChange,
	type StructuralChange
} from '../structural-change';
import { normalizeItemMarkerToList, renumberOrderedList } from '../list/ordered-markers';
import { orderedBaseOf, readOrderedSuffix } from '../list/list-builders';
import { spliceTerminatedItems } from '../list/terminator';
import type { PasteDispatchContext } from './dispatch';
import type { MultiScopeTarget } from './paste-deps';
import type { SharingState } from '../sharing';
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
		/** The target leaf's bytes AFTER the paste's delete half. */
		targetRaw: string;
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
	crossBlockContext: boolean,
	targetRaw?: string
): ContainerUnwrap | null {
	if (parsed.children.length !== 1) return null;
	const topBlock = parsed.children[0];
	const containerPaste = containerPasteFor(topBlock.kind);
	if (!containerPaste) return null;
	if (!topBlock.children || topBlock.children.length === 0) return null;

	// The bytes the strategies decide on: the target's own, post-delete.
	const targetLeaf = nodeAt(doc, targetPath) as CstNode | null;
	const postDelete = { node: targetLeaf, raw: targetRaw ?? targetLeaf?.raw ?? '' };

	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = targetPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath) as CstNode | null;
		if (!ancestor) break;
		if (ancestor.kind !== topBlock.kind) continue;
		if (!containerPaste.matchesAncestor(topBlock, ancestor)) continue;

		const spliceIndex = targetPath[depth];
		const targetChild = ancestor.children?.[spliceIndex];
		if (!targetChild) continue;

		if (isEmptyContainerChild(targetChild, postDelete)) {
			return { outerPath: ancestorPath, spliceIndex, items: topBlock.children };
		}

		// Merge-first / trailing-residue semantics are only well-defined for
		// single-paragraph first and last items.
		if (!crossBlockContext) return null;
		if (!singleParagraphChildOf(topBlock.children[0])) return null;
		if (!singleParagraphChildOf(topBlock.children[topBlock.children.length - 1])) return null;

		return {
			outerPath: ancestorPath,
			spliceIndex,
			items: topBlock.children,
			merge: { targetLeafPath: targetPath, offset, targetRaw: postDelete.raw }
		};
	}
	return null;
}

/** One leaf child whose raw has no visible content (post-cross-block-delete stub). */
function isEmptyContainerChild(
	node: CstNode,
	postDelete: { node: CstNode | null; raw: string }
): boolean {
	const rawOf = (n: CstNode) => (n === postDelete.node ? postDelete.raw : n.raw);
	if (!node.children || node.children.length === 0) return rawOf(node).trim() === '';
	if (node.children.length !== 1) return false;
	const c = node.children[0];
	if (c.kind !== 'paragraph') return false;
	return rawOf(c).trim() === '';
}

/**
 * The one paragraph an unwrapped item's text may be spliced as. The merge slices a DISPLAY
 * offset out of the target leaf and reattaches the residue, which only prose bytes address —
 * so both writes re-read this rather than trusting the finder's gate from a distance.
 */
function singleParagraphChildOf(node: CstNode): CstNode | null {
	if (!node.children || node.children.length !== 1) return null;
	const child = node.children[0];
	return child.kind === 'paragraph' ? child : null;
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
	const outerState = containerScopeState(ctx.controller, outer);

	if (unwrap.merge) {
		await applyContainerMatchingMerge(unwrap, unwrap.merge, outer, outerState, ctx);
		return;
	}

	normalizePastedListMarkers(unwrap.items, outer);
	renumberPastedOrderedMarkers(unwrap.items, outer, unwrap.spliceIndex);

	const snapshot =
		ctx.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom(unwrap.outerPath), offset: 0 };

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot,
		mutate: ([scopeView]) => {
			spliceTerminatedItems(scopeView.children, unwrap.spliceIndex, 1, unwrap.items);
			const change: StructuralChange = {
				op: 'replace',
				at: unwrap.spliceIndex,
				count: 1,
				newCount: unwrap.items.length
			};
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
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

/** A single-item clipboard keeps everything in the target leaf. */
async function applyContainerMatchingMerge(
	unwrap: ContainerUnwrap,
	merge: NonNullable<ContainerUnwrap['merge']>,
	outer: CstNode,
	outerState: MultiScopeTarget['state'],
	ctx: PasteDispatchContext
): Promise<void> {
	const targetLeaf = nodeAt(ctx.doc, merge.targetLeafPath) as CstNode | null;
	if (!targetLeaf) return;

	const firstLeaf = singleParagraphChildOf(unwrap.items[0]);
	const lastLeaf = singleParagraphChildOf(unwrap.items[unwrap.items.length - 1]);
	if (!firstLeaf || !lastLeaf) {
		// Unreachable while the finder's gate holds. Declining before the commit keeps a drifted
		// gate a clean no-op, and the diagnostic is what stops that drift being silent.
		devWarn('paste-container-match', 'merge items are no longer single-paragraph', {
			first: unwrap.items[0].kind,
			last: unwrap.items[unwrap.items.length - 1].kind
		});
		return;
	}

	// Post-delete bytes: the door spent the paste's delete half before picking this strategy.
	const targetLineEnding = trailingLineEnding(merge.targetRaw);
	const targetDisplay = trimTrailingLineEnding(merge.targetRaw);
	const displayBefore = targetDisplay.slice(0, merge.offset);
	const displayAfter = targetDisplay.slice(merge.offset);
	const firstItemText = trimTrailingLineEnding(firstLeaf.raw);

	const remainingItems = unwrap.items.slice(1);
	// The first item merges into the target leaf, keeping its marker; only the trailing
	// siblings splice in, landing after the target.
	normalizePastedListMarkers(remainingItems, outer);
	renumberPastedOrderedMarkers(remainingItems, outer, unwrap.spliceIndex + 1);

	const snapshot =
		ctx.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom(unwrap.outerPath), offset: 0 };
	/** The merged leaf sits BELOW the scope node — own its full spine. */
	const ownMergedLeafSpine = (sharing: SharingState) => {
		const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
		return { chain, ownedLeaf: chain[chain.length - 1] ?? ensureUnsharedNode(targetLeaf, sharing) };
	};

	if (remainingItems.length === 0) {
		await ctx.controller.commitMultiScope({
			scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
			snapshot,
			mutate: ([scopeView]) => {
				const sharing = scopeView.sharing;
				const { chain, ownedLeaf } = ownMergedLeafSpine(sharing);
				writeOwnRaw(
					ownedLeaf,
					displayBefore + firstItemText + displayAfter + targetLineEnding,
					ctx.grammar
				);
				rebuildUnsharedChain(ctx.doc, chain, sharing, null, ctx.grammar);
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
	const lastLineEnding = trailingLineEnding(lastLeaf.raw);
	const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);
	let residue: SettledContent = { change: { op: 'noop' }, textStart: 0 };

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot,
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			const { chain, ownedLeaf } = ownMergedLeafSpine(sharing);
			writeOwnRaw(ownedLeaf, displayBefore + firstItemText + targetLineEnding, ctx.grammar);
			// The residue can cross a kind boundary (a fence closer landing in a paragraph),
			// so it reattaches through the reparse funnel, never a bare write.
			residue = updateNodeContent(
				{ children: lastItem.children!, ownerKind: lastItem.kind, owner: lastItem },
				0,
				lastDisplay + displayAfter + lastLineEnding,
				ctx.grammar,
				sharing
			);
			// The write's settle can splice the item's own body, a scope this commit's descriptor
			// does not cover: its ids stay in step here, and the caret rides it below.
			if (lastItem.childIds) {
				applyStructuralChangeToIdsRefs(
					residue.change,
					lastItem.childIds,
					new Array(lastItem.childIds.length)
				);
			}
			// Both rebuilds run before the splice, so the published children carry correct
			// raws in one reactive flush.
			rebuildUnsharedChain(ctx.doc, chain, sharing, null, ctx.grammar);
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
			// rather than CURSOR_END on the item — at the slot the residue's own settle left it in.
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			const target = settledCaretTarget(residue, 0, lastDisplay.length, lastItem.children ?? []);
			return ctx.controller.landCaret(
				[...unwrap.outerPath, lastInsertedIdx, target.index],
				target.offset
			);
		}
	});
}
