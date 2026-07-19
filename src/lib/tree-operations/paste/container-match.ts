/**
 * Container-matching unwrap: when the clipboard's top block is a container
 * kind declaring `containerPaste` and a same-kind ancestor passes its
 * `matchesAncestor` predicate, splice items into that ancestor instead of
 * nesting a sub-container.
 */

import { CURSOR_END } from '../../block-component';
import { metadataOf, type CstNode, type Document } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { nodeAt } from '../node-ops';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { rebuildContainerRawIfContainer } from '../../schema/container-raw';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../unshare';
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { normalizeItemMarkerToList, renumberOrderedList } from '../list/ordered-markers';
import { orderedBaseOf, readOrderedSuffix } from '../list/list-builders';
import { spliceTerminatedItems } from '../list/terminator';
import type { PasteDispatchContext } from './dispatch';
import type { MultiScopeTarget } from './paste-deps';
import { dispatchFocusByPath } from '../../editor-actions/focus/focus-dispatch';
import { docPathFrom } from '../../cursor/coordinate-spaces';

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

/**
 * Template pasted items' bullet glyph to a matching unordered `list` ancestor
 * before they splice in, so a `*`/`+` paste into a `- ` list serializes as one
 * list to reference parsers, not two. Markers are set on the not-yet-spliced
 * items — Svelte-5's precompute-before-splice discipline (see `list-absorb`).
 *
 * Scoped to unordered lists: `matchesAncestor` requires equal ordered flags, so
 * an unordered ancestor only ever receives unordered items; ordered ancestors
 * keep the pasted numbering, and non-list containers (blockquote) have no
 * listItem markers to touch.
 */
function normalizePastedListMarkers(items: CstNode[], outer: CstNode): void {
	if (outer.kind !== 'list' || metadataOf(outer, 'list')?.ordered) return;
	for (const item of items) normalizeItemMarkerToList(item, outer);
}

/**
 * Ordered counterpart of normalizePastedListMarkers: number the pasted items to
 * continue an ordered `list` ancestor's sequence from `firstIndex` (their splice
 * position). No-op for unordered lists and non-list containers. Markers are set
 * on the not-yet-spliced items — Svelte-5's precompute-before-splice discipline
 * (see `list-absorb`); the caller renumbers the already-proxied tail after the
 * splice with `renumberOrderedList`.
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
			// Renumber the already-proxied tail; the pasted items carry precomputed
			// markers. No-op for unordered lists / non-list containers.
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
	outerState: MultiScopeTarget['state'],
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
	// The first item's content merges into the target leaf (keeping its marker);
	// only the trailing siblings splice in, so only those need the glyph adopted /
	// number assigned. They land after the target at spliceIndex + 1.
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
				const ownedLeaf = chain[chain.length - 1] ?? targetLeaf;
				ownedLeaf.raw = displayBefore + firstItemText + displayAfter + targetLineEnding;
				rebuildUnsharedChain(chain, sharing);
				return [{ op: 'noop' }];
			},
			op: {
				kind: 'paste',
				detail: { source: 'container-matching-merge-singleton', outerPath: unwrap.outerPath },
				eventPath: docPathFrom(unwrap.outerPath)
			},
			afterTick: () => {
				// End of the pasted content, before the reattached residue (displayAfter).
				// The residue lives INSIDE the merged leaf, so this is a char offset in
				// that leaf, not a block index — the container ref's focus(number) clamps
				// a non-sentinel offset to the last child's end, so descend by path.
				const subPath = merge.targetLeafPath.slice(unwrap.outerPath.length);
				dispatchFocusByPath(
					outerState.innerBlockRefs,
					subPath,
					displayBefore.length + firstItemText.length
				);
			}
		});
		return;
	}

	const lastItem = remainingItems[remainingItems.length - 1];
	// findContainerMatchingUnwrap's hasSingleParagraphChild guard ensures this;
	// the bail keeps a refactor that updates one guard but not the other from
	// NPE-ing mid-commit — it fires before commitMultiScope, so the paste is a
	// clean no-op rather than a half-applied mutation.
	const lastLeaf = lastItem.children?.[0];
	if (!lastLeaf) return;
	const lastLineEnding = lastLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: unwrap.outerPath }],
		snapshot:
			ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(unwrap.outerPath), offset: 0 },
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			// The merged leaf sits BELOW the scope node — own its full spine.
			// lastLeaf lives inside the parsed clipboard items (created, safe).
			const chain = ensureUnsharedPath(ctx.doc, merge.targetLeafPath, sharing);
			const ownedLeaf = chain[chain.length - 1] ?? targetLeaf;
			ownedLeaf.raw = displayBefore + firstItemText + targetLineEnding;
			lastLeaf.raw = lastDisplay + displayAfter + lastLineEnding;
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
			// Renumber the already-proxied tail below the spliced siblings; the merged
			// target keeps its number. No-op for unordered lists / non-list containers.
			renumberOrderedList(scopeView.node, unwrap.spliceIndex + 1 + remainingItems.length, sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'container-matching-merge', outerPath: unwrap.outerPath },
			eventPath: docPathFrom(unwrap.outerPath)
		},
		afterTick: () => {
			// End of the pasted content: the last spliced item's paragraph, at the
			// join before the reattached residue (displayAfter) — a char offset in
			// that leaf, so descend by path rather than CURSOR_END on the item ref.
			const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
			dispatchFocusByPath(outerState.innerBlockRefs, [lastInsertedIdx, 0], lastDisplay.length);
		}
	});
}
