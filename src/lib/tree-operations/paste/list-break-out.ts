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
import { rebuildListRaw, rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import { ensureListItemNewlineTerminated } from '../list/terminator';
import {
	assembleListHalf,
	buildListItemWithContent,
	orderedBaseOf,
	splitLeafForPaste
} from '../list/list-builders';
import { findEnclosingListForPaste } from './find-enclosing-list';
import { parseAllInlineContent } from '../../core/inline';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { MultiScopeTarget } from './paste-deps';
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
 * a plan only when the clipboard's top-list ordered flag differs from the
 * nearest list ancestor's — same-type pastes are handled by `list-absorb`
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
	if (topBlock.kind !== 'list') return null;

	const enclosing = findEnclosingListForPaste(doc, targetPath);
	if (!enclosing) return null;

	const listOrdered =
		(enclosing.list.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	const pastedOrdered = (topBlock.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	if (listOrdered === pastedOrdered) return null;

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

	const replacement = buildListBreakOutReplacement(
		list,
		plan.itemIndex,
		plan.innerIndex,
		plan.offset,
		pastedBlocks
	);
	if (replacement.length === 0) return;

	for (const node of replacement) ensureEditableContainers(node);
	parseAllInlineContent(replacement);

	const parentScope = resolveParentScope(plan, ctx);
	if (!parentScope) return;
	const listIndex = plan.listPath[plan.listPath.length - 1] ?? plan.listPath[0];
	const spliceIndex = plan.listPath.length === 1 ? plan.listPath[0] : listIndex;

	await ctx.controller.commitMultiScope({
		scopes: [parentScope],
		snapshot: ctx.skipSnapshot ? 'skip' : { blockIndex: plan.listPath[0], offset: 0 },
		mutate: (scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(spliceIndex, 1, ...replacement);
			parentScope.node.children = children;
			const lastInsertedIdx = spliceIndex + replacement.length - 1;
			const parentPath = plan.listPath.slice(0, -1);
			rebuildAncestryRawForLeaf(ctx.doc, [...parentPath, lastInsertedIdx]);
			return [
				{
					op: 'replace',
					at: spliceIndex,
					count: 1,
					newCount: replacement.length
				}
			];
		},
		op: {
			kind: 'paste',
			detail: { source: 'list-break-out', listPath: plan.listPath },
			eventPath: plan.listPath
		},
		afterTick: () => {
			const lastInsertedIdx = spliceIndex + replacement.length - 1;
			parentScope.state.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
		}
	});
}

// ── Replacement builder (pure, testable) ─────────────────────────────────────

/**
 * Split `list` at `(itemIndex, innerIndex, offset)` and splice `pastedBlocks`
 * between the halves. Returns `[firstHalfList?, ...pastedBlocks, secondHalfList?]`
 * — halves are omitted when empty. Input nodes are cloned, not mutated.
 */
export function buildListBreakOutReplacement(
	list: CstNode,
	itemIndex: number,
	innerIndex: number,
	offset: number,
	pastedBlocks: CstNode[]
): CstNode[] {
	const items = list.children ?? [];
	const item = items[itemIndex];
	if (!item?.children) return [];
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return [];

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

	const replacement: CstNode[] = [];
	if (firstHalfItems.length > 0) {
		replacement.push(assembleListHalf(list, firstHalfItems, 1));
	}
	for (const block of pastedBlocks) {
		const cloned = cloneNode(block);
		// Clipboards without a trailing newline leave the last pasted item's
		// raw un-terminated; when concatenated with the next block, the two
		// mash (e.g. "3. Ordered" + "- third" → "3. Ordered- third").
		if (cloned.kind === 'list' && cloned.children) {
			for (const item of cloned.children) ensureListItemNewlineTerminated(item);
			rebuildListRaw(cloned);
		}
		replacement.push(cloned);
	}
	if (secondHalfItems.length > 0) {
		// Continue numbering across the paste gap — the split item consumes
		// one slot in each half, so second half starts at firstHalfItems.length + 1.
		const startNumber =
			firstHalfItems.length > 0 ? firstHalfItems.length + 1 : orderedBaseOf(items[0]);
		replacement.push(assembleListHalf(list, secondHalfItems, startNumber));
	}

	return replacement;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function resolveParentScope(
	plan: ListBreakOut,
	ctx: PasteDispatchContext
): MultiScopeTarget | null {
	if (plan.listPath.length === 1) {
		return ctx.controller.getDocScope();
	}
	const parentPath = plan.listPath.slice(0, -1);
	const parent = nodeAt(ctx.doc, parentPath) as CstNode | null;
	if (!parent) return null;
	return { node: parent, state: expectStateForNode(parent) };
}
