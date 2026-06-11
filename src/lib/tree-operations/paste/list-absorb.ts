/**
 * Paste absorb: when the clipboard is a same-type list (matching ordered
 * flag) pasted into a non-empty list item, flatten the pasted items as
 * siblings of the target in the enclosing list. Mutates the list's children
 * in place, normalizes pasted markers to the list's style, and renumbers
 * from 1 — producing the flat "continuous-sequence" result most markdown
 * editors use (Obsidian, Google Docs).
 *
 * Complements the mismatched-type `list-break-out` path: same-type pastes
 * never belong in a break-out. Runs after `findContainerMatchingUnwrap`
 * (which handles empty-target and cross-block cases); this module covers
 * the single-block non-empty same-type case that would otherwise fall
 * through to the default structural paste (nested sub-list).
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { nodeAt, ensureEditableContainers } from '../node-ops';
import { cloneNode } from '../clone';
import {
	rebuildListItemRaw,
	rebuildListRaw,
	rebuildAncestryRawForLeaf
} from '../../schema/container-raw';
import { renumberOrderedList } from '../list/ordered-markers';
import { ensureListItemNewlineTerminated } from '../list/terminator';
import {
	buildListItemWithContent,
	readOrderedSuffix,
	splitLeafForPaste
} from '../list/list-builders';
import { findEnclosingListForPaste } from './find-enclosing-list';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { PasteDispatchContext } from './dispatch';

// ── Public API ───────────────────────────────────────────────────────────────

export interface ListAbsorb {
	listPath: number[];
	itemIndex: number;
	innerIndex: number;
	offset: number;
}

/**
 * Detect whether to absorb a same-type list paste into the enclosing list.
 * Returns a plan or null. Preconditions:
 *  - clipboard is a single `list` top-block
 *  - clipboard's ordered flag matches the nearest list ancestor's
 *  - target is a direct leaf of the listItem (simple shape)
 *
 * Mismatched-type pastes fall through to `findListBreakOut`.
 */
export function findListAbsorb(
	doc: Document,
	targetPath: number[],
	parsed: Document,
	offset: number
): ListAbsorb | null {
	if (parsed.children.length !== 1) return null;
	const topBlock = parsed.children[0];
	if (topBlock.kind !== 'list') return null;

	const enclosing = findEnclosingListForPaste(doc, targetPath);
	if (!enclosing) return null;

	const listOrdered = metadataOf(enclosing.list, 'list')?.ordered ?? false;
	const pastedOrdered = metadataOf(topBlock, 'list')?.ordered ?? false;
	if (listOrdered !== pastedOrdered) return null;

	return {
		listPath: enclosing.listPath,
		itemIndex: enclosing.itemIndex,
		innerIndex: enclosing.innerIndex,
		offset
	};
}

/**
 * Execute a same-type absorb. Splits the target item at the caret, splices
 * the pasted items between the resulting halves, normalizes markers, and
 * renumbers the list. Commits as a single undo entry on the list's scope.
 */
export async function applyListAbsorb(
	plan: ListAbsorb,
	pastedList: CstNode,
	ctx: PasteDispatchContext
): Promise<void> {
	const outer = nodeAt(ctx.doc, plan.listPath) as CstNode | null;
	if (!outer?.children) return;
	const outerState = expectStateForNode(outer);

	const item = outer.children[plan.itemIndex];
	if (!item?.children) return;
	const targetLeaf = item.children[plan.innerIndex];
	if (!targetLeaf) return;

	const { leadingItem, trailingItem } = buildSplitItems(item, plan.innerIndex, plan.offset);
	const pastedItems = (pastedList.children ?? []).map((c) => cloneNode(c));

	// Replace the target item with [leadingItem?, ...pastedItems, trailingItem?].
	const replacement: CstNode[] = [];
	if (leadingItem) replacement.push(leadingItem);
	for (const p of pastedItems) replacement.push(p);
	if (trailingItem) replacement.push(trailingItem);

	for (const node of replacement) {
		ensureEditableContainers(node);
		// Pasted items from clipboards without trailing newlines have no-\n raw;
		// splicing them mid-list would mash adjacent items during rebuildListRaw.
		ensureListItemNewlineTerminated(node);
	}

	const outerOrdered = metadataOf(outer, 'list')?.ordered ?? false;
	const pastedStart = plan.itemIndex + (leadingItem ? 1 : 0);

	// Pre-compute final markers on the replacement items BEFORE splice. Svelte 5's
	// $state proxies wrap entries lazily on access, and mutations to newly-spliced
	// items bypass reactivity unless they go through the proxy's set trap. By
	// assigning final markers before splice, we only need to renumber already-
	// proxied existing items after the splice region — which does propagate.
	if (outerOrdered) {
		const suffix = readOrderedSuffix(outer);
		for (let i = 0; i < replacement.length; i++) {
			const item = replacement[i];
			const meta = metadataOf(item, 'listItem');
			if (meta) {
				meta.marker = String(plan.itemIndex + 1 + i) + suffix;
				rebuildListItemRaw(item);
			}
		}
	}

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState }],
		snapshot: ctx.skipSnapshot ? 'skip' : { blockIndex: plan.listPath[0], offset: 0 },
		mutate: (scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(plan.itemIndex, 1, ...replacement);
			outer.children = children;

			// Renumber only items AFTER the replacement region. Their proxies
			// already exist (they were in the list before paste), so marker
			// mutations propagate to the DOM.
			const afterReplacementIdx = plan.itemIndex + replacement.length;
			if (outerOrdered && afterReplacementIdx < outer.children.length) {
				renumberOrderedList(outer, afterReplacementIdx);
			}
			rebuildListRaw(outer);
			rebuildAncestryRawForLeaf(ctx.doc, [...plan.listPath, plan.itemIndex]);

			return [
				{
					op: 'replace',
					at: plan.itemIndex,
					count: 1,
					newCount: replacement.length
				}
			];
		},
		op: {
			kind: 'paste',
			detail: { source: 'list-absorb', listPath: plan.listPath },
			eventPath: plan.listPath
		},
		afterTick: () => {
			const lastPastedIdx = pastedStart + pastedItems.length - 1;
			outerState.innerBlockRefs[lastPastedIdx]?.focus(CURSOR_END);
		}
	});
}

// ── Split builder ────────────────────────────────────────────────────────────

/**
 * Produce the leading and trailing items that replace `item` when a paste
 * absorbs at `(innerIndex, offset)`. Either side may be null when the caret
 * sits flush against a boundary and no residue remains.
 */
function buildSplitItems(
	item: CstNode,
	innerIndex: number,
	offset: number
): { leadingItem: CstNode | null; trailingItem: CstNode | null } {
	if (!item.children) return { leadingItem: null, trailingItem: null };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { leadingItem: null, trailingItem: null };

	const { leadingNode, trailingNode } = splitLeafForPaste(targetLeaf, offset);

	const leadingChildren: CstNode[] = item.children.slice(0, innerIndex).map(cloneNode);
	if (leadingNode) leadingChildren.push(leadingNode);

	const trailingChildren: CstNode[] = [];
	if (trailingNode) trailingChildren.push(trailingNode);
	for (const c of item.children.slice(innerIndex + 1)) trailingChildren.push(cloneNode(c));
	if (trailingChildren[0]) trailingChildren[0].leadingTrivia = '';

	return {
		leadingItem:
			leadingChildren.length > 0 ? buildListItemWithContent(item, leadingChildren) : null,
		trailingItem:
			trailingChildren.length > 0 ? buildListItemWithContent(item, trailingChildren) : null
	};
}
