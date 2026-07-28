/**
 * Paste absorb: when the clipboard is a same-type list (matching ordered
 * flag) pasted into a non-empty list item, flatten the pasted items as
 * siblings of the target in the enclosing list. Mutates the list's children
 * in place and normalizes pasted markers to the enclosing list's style — the
 * bullet glyph for unordered, a continuous renumbered sequence for ordered —
 * producing the flat result most markdown editors use (Obsidian, Google Docs).
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
import { containerPasteFor } from './container-paste';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { renumberOrderedList, normalizeItemMarkerToList } from '../list/ordered-markers';
import { spliceTerminatedItems } from '../list/terminator';
import { containerScopeState } from './parent-scope';
import {
	buildListItemWithContent,
	orderedBaseOf,
	readOrderedSuffix,
	splitLeafForPaste
} from '../list/list-builders';
import { findEnclosingListForPaste } from './find-enclosing-list';
import { focusIndexBeforeResidue } from './focus-target';
import { docPathFrom } from '../../cursor/coordinate-spaces';
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
 *  - clipboard is a single top block declaring `containerPaste.siblingAbsorb`
 *  - its `matchesAncestor` predicate accepts the nearest list ancestor
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
	const containerPaste = containerPasteFor(topBlock.kind);
	if (!containerPaste?.siblingAbsorb) return null;

	const enclosing = findEnclosingListForPaste(doc, targetPath);
	if (!enclosing) return null;

	if (!containerPaste.matchesAncestor(topBlock, enclosing.list)) return null;

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
	const outerState = containerScopeState(ctx.controller, outer);

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

	for (const node of replacement) ensureEditableContainers(node);

	const outerOrdered = metadataOf(outer, 'list')?.ordered ?? false;

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
				meta.marker = String(orderedBaseOf(outer.children[0]) + plan.itemIndex + i) + suffix;
				rebuildListItemRaw(item);
			}
		}
	} else {
		// Unordered: template the pasted items' bullet glyph from the enclosing
		// list so a `*`/`+` paste into a `- ` list serializes as one list to
		// reference parsers, not two. Same precompute-before-splice discipline.
		for (const item of replacement) normalizeItemMarkerToList(item, outer);
	}

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: plan.listPath }],
		snapshot: ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(plan.listPath), offset: 0 },
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			spliceTerminatedItems(scopeView.children, plan.itemIndex, 1, replacement);

			// Renumber only items AFTER the replacement region. Their proxies
			// already exist (they were in the list before paste), so marker
			// mutations propagate to the DOM.
			const afterReplacementIdx = plan.itemIndex + replacement.length;
			if (outerOrdered && afterReplacementIdx < scopeView.children.length) {
				renumberOrderedList(scopeView.node, afterReplacementIdx, sharing);
			}

			const change: StructuralChange = {
				op: 'replace',
				at: plan.itemIndex,
				count: 1,
				newCount: replacement.length
			};
			stampStructuralChange(scopeView.children, change, sharing);
			return [change];
		},
		op: {
			kind: 'paste',
			detail: { source: 'list-absorb', listPath: plan.listPath },
			eventPath: docPathFrom(plan.listPath)
		},
		afterTick: () => {
			// End of the pasted content: the last pasted item, before the trailing
			// residue item — the shared structural-paste landing rule.
			const lastPastedIdx =
				plan.itemIndex + focusIndexBeforeResidue(replacement.length, trailingItem !== null);
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
