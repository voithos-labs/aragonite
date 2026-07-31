/**
 * Paste break-out: lift a pasted list out of an enclosing list rather than nesting it,
 * whenever the two ordered flags disagree — keeping the pasted list separate preserves its
 * semantic type. Same-type pastes go through `list-absorb`.
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
 * The break-out plan, or null: requires a top block declaring `containerPaste.siblingAbsorb`
 * whose `matchesAncestor` REJECTS the nearest list ancestor (matching pastes belong to
 * `list-absorb` and must not also trigger here), targeting a direct leaf of the listItem.
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
 * Split the enclosing list at the target item and splice the pasted blocks between the
 * halves at the list's parent level, in one multi-scope entry.
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
			// The last pasted block, never the second-half residue list.
			const lastPastedIdx =
				spliceIndex + focusIndexBeforeResidue(replacement.length, hasTrailingResidue);
			return ctx.controller.landCaret([...parentScope.path, lastPastedIdx], CURSOR_END);
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
 * Split `list` at `(itemIndex, innerIndex, offset)` and splice `pastedBlocks` between the
 * halves. `hasTrailingResidue` lets the caller land the caret on the last pasted block
 * rather than the residue. Input nodes are cloned, not mutated.
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
		// Normalize the clone's items so its rebuilt raw can't mash into the next block.
		// The ending comes from the list being broken out of — the pasted block lands
		// among its lines.
		if (cloned.kind === 'list' && cloned.children) {
			newlineTerminateListItems(cloned.children, trailingLineEnding(list.raw));
			rebuildListRaw(cloned);
		}
		replacement.push(cloned);
	}
	const hasTrailingResidue = secondHalfItems.length > 0;
	if (hasTrailingResidue) {
		// Continue numbering across the paste gap: the split item consumes one slot in each
		// half, so the second half starts past the first half's count.
		replacement.push(assembleListHalf(list, secondHalfItems, base + firstHalfItems.length));
	}

	return { replacement, hasTrailingResidue };
}
