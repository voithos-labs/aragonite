/**
 * Paste break-out: lift a pasted list out of an enclosing list instead of
 * nesting it as a sub-list. Triggers when the clipboard's top block is a
 * list whose ordered flag does NOT match the nearest list ancestor, and
 * the target is a direct leaf of a listItem.
 *
 * Same-type pastes go through `list-absorb` (flatten into the enclosing
 * list with renumbering); this module covers only the mismatched case,
 * where keeping the pasted list separate preserves its semantic type.
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import { nodeAt, ensureEditableContainers } from '../node-ops';
import { cloneNode } from '../clone';
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { containerPasteFor } from './container-paste';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import { newlineTerminateListItems } from '../list/terminator';
import { trailingLineEnding } from '../../core/lines';
import {
	assembleListHalf,
	buildListItemWithContent,
	orderedBaseOf,
	splitLeafForPaste
} from '../list/list-builders';
import { findEnclosingListForPaste } from './find-enclosing-list';
import { focusIndexBeforeResidue } from './focus-target';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { resolveParentScope } from './parent-scope';
import type { PasteDispatchContext } from './dispatch';

// ── Public API ───────────────────────────────────────────────────────────────

export interface ListBreakOut {
	/** Path to the nearest enclosing list ancestor. */
	listPath: number[];
	/** Index of the enclosing listItem within the list. */
	itemIndex: number;
	/** Index of the target leaf within the enclosing listItem's children. */
	innerIndex: number;
	/** Caret offset within the target leaf's raw. */
	offset: number;
}

/**
 * Detect whether to break out of an enclosing list for this paste. Returns
 * a plan only when the clipboard's top block declares
 * `containerPaste.siblingAbsorb` but its `matchesAncestor` predicate rejects
 * the nearest list ancestor — matching pastes are handled by `list-absorb`
 * and must not also trigger here. Target must be a direct leaf of the
 * listItem (simple shape); deeper targets fall through.
 */
export function findListBreakOut(
	doc: Document,
	targetPath: number[],
	parsed: Document,
	offset: number
): ListBreakOut | null {
	if (parsed.children.length === 0) return null;
	const topBlock = parsed.children[0];
	const containerPaste = containerPasteFor(topBlock.kind);
	if (!containerPaste?.siblingAbsorb) return null;

	const enclosing = findEnclosingListForPaste(doc, targetPath);
	if (!enclosing) return null;

	if (containerPaste.matchesAncestor(topBlock, enclosing.list)) return null;

	return {
		listPath: enclosing.listPath,
		itemIndex: enclosing.itemIndex,
		innerIndex: enclosing.innerIndex,
		offset
	};
}

/**
 * Execute a list break-out. Splits the enclosing list at the target item,
 * splices the pasted blocks between the halves at the list's parent level,
 * and commits in one multi-scope entry.
 */
export async function applyListBreakOut(
	plan: ListBreakOut,
	pastedBlocks: CstNode[],
	ctx: PasteDispatchContext
): Promise<void> {
	const list = nodeAt(ctx.doc, plan.listPath) as CstNode | null;
	if (!list?.children) return;

	const { replacement, hasTrailingResidue } = buildListBreakOutReplacement(
		list,
		plan.itemIndex,
		plan.innerIndex,
		plan.offset,
		pastedBlocks
	);
	if (replacement.length === 0) return;

	for (const node of replacement) ensureEditableContainers(node);

	const parentScope = resolveParentScope(ctx.doc, plan.listPath, ctx.controller);
	if (!parentScope) return;
	const spliceIndex = plan.listPath[plan.listPath.length - 1];

	await ctx.controller.commitMultiScope({
		scopes: [parentScope],
		snapshot: ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(plan.listPath), offset: 0 },
		mutate: ([scopeView]) => {
			scopeView.children.splice(spliceIndex, 1, ...replacement);
			const change: StructuralChange = {
				op: 'replace',
				at: spliceIndex,
				count: 1,
				newCount: replacement.length
			};
			stampStructuralChange(scopeView.children, change, scopeView.sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'list-break-out', listPath: plan.listPath },
			eventPath: docPathFrom(plan.listPath)
		},
		afterTick: () => {
			// End of the pasted content: the last pasted block, before the second-half
			// residue list — never the residue itself.
			const lastPastedIdx =
				spliceIndex + focusIndexBeforeResidue(replacement.length, hasTrailingResidue);
			parentScope.state.innerBlockRefs[lastPastedIdx]?.focus(CURSOR_END);
		}
	});
}

// ── Replacement builder (pure, testable) ─────────────────────────────────────

export interface ListBreakOutReplacement {
	/** `[firstHalfList?, ...pastedBlocks, secondHalfList?]` — halves omitted when empty. */
	replacement: CstNode[];
	/** The second-half list (post-caret residue) is present as the last node. */
	hasTrailingResidue: boolean;
}

/**
 * Split `list` at `(itemIndex, innerIndex, offset)` and splice `pastedBlocks`
 * between the halves. Returns `[firstHalfList?, ...pastedBlocks, secondHalfList?]`
 * — halves are omitted when empty — plus whether the trailing residue half is
 * present, so the caller can land the caret on the last pasted block rather than
 * the residue. Input nodes are cloned, not mutated.
 */
export function buildListBreakOutReplacement(
	list: CstNode,
	itemIndex: number,
	innerIndex: number,
	offset: number,
	pastedBlocks: CstNode[]
): ListBreakOutReplacement {
	const items = list.children ?? [];
	const item = items[itemIndex];
	if (!item?.children) return { replacement: [], hasTrailingResidue: false };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { replacement: [], hasTrailingResidue: false };

	const { leadingNode: leadingSliceNode, trailingNode: trailingSliceNode } = splitLeafForPaste(
		targetLeaf,
		offset
	);

	const itemChildrenBefore = item.children.slice(0, innerIndex).map(cloneNode);
	const itemChildrenAfter = item.children.slice(innerIndex + 1).map(cloneNode);

	const firstHalfItemChildren: CstNode[] = [...itemChildrenBefore];
	if (leadingSliceNode) firstHalfItemChildren.push(leadingSliceNode);

	const secondHalfItemChildren: CstNode[] = [];
	if (trailingSliceNode) secondHalfItemChildren.push(trailingSliceNode);
	for (const child of itemChildrenAfter) secondHalfItemChildren.push(child);
	if (secondHalfItemChildren[0]) secondHalfItemChildren[0].leadingTrivia = '';

	const itemsBefore = items.slice(0, itemIndex).map(cloneNode);
	const itemsAfter = items.slice(itemIndex + 1).map(cloneNode);
	if (itemsAfter[0]) itemsAfter[0].leadingTrivia = '';

	const firstHalfItems: CstNode[] = [...itemsBefore];
	if (firstHalfItemChildren.length > 0) {
		firstHalfItems.push(buildListItemWithContent(item, firstHalfItemChildren));
	}

	const secondHalfItems: CstNode[] = [];
	if (secondHalfItemChildren.length > 0) {
		secondHalfItems.push(buildListItemWithContent(item, secondHalfItemChildren));
	}
	secondHalfItems.push(...itemsAfter);

	const base = orderedBaseOf(items[0]);
	const replacement: CstNode[] = [];
	if (firstHalfItems.length > 0) {
		replacement.push(assembleListHalf(list, firstHalfItems, base));
	}
	for (const block of pastedBlocks) {
		const cloned = cloneNode(block);
		// No children-array splice here — the cloned list itself is the unit;
		// normalize its items so its rebuilt raw can't mash into the next block.
		// The ending comes from the list being broken out of: the pasted block is
		// landing among its lines.
		if (cloned.kind === 'list' && cloned.children) {
			newlineTerminateListItems(cloned.children, trailingLineEnding(list.raw));
			rebuildListRaw(cloned);
		}
		replacement.push(cloned);
	}
	const hasTrailingResidue = secondHalfItems.length > 0;
	if (hasTrailingResidue) {
		// Continue numbering across the paste gap from the list's own base — the
		// split item consumes one slot in each half, so the second half starts at
		// base + (number of first-half items).
		replacement.push(assembleListHalf(list, secondHalfItems, base + firstHalfItems.length));
	}

	return { replacement, hasTrailingResidue };
}
