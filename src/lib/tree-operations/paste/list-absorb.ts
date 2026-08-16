/**
 * Paste absorb: a same-type list pasted into a non-empty list item flattens as siblings of
 * the target, with markers normalized to the enclosing list's style — the flat result most
 * markdown editors produce. Covers the single-block non-empty same-type case that runs
 * after `findContainerMatchingUnwrap` and would otherwise fall through to the default
 * structural paste; mismatched types go to `list-break-out` instead.
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
	/** The target leaf's bytes AFTER the paste's delete half. */
	targetRaw?: string;
}

/**
 * The absorb plan, or null when any precondition fails: a single top block declaring
 * `containerPaste.siblingAbsorb`, whose `matchesAncestor` accepts the nearest list
 * ancestor, targeting a direct leaf of the listItem. Mismatched types fall through to
 * `findListBreakOut`.
 */
export function findListAbsorb(
	doc: Document,
	targetPath: number[],
	parsed: Document,
	offset: number,
	targetRaw?: string
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
		offset,
		targetRaw
	};
}

/**
 * Split the target item at the caret, splice the pasted items between the halves,
 * normalize markers, renumber. One undo entry on the list's scope.
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
	if (!item.children[plan.innerIndex]) return;

	const { leadingItem, trailingItem } = buildSplitItems(
		item,
		plan.innerIndex,
		plan.offset,
		plan.targetRaw
	);
	const pastedItems = (pastedList.children ?? []).map((c) => cloneNode(c));

	const replacement: CstNode[] = [];
	if (leadingItem) replacement.push(leadingItem);
	for (const p of pastedItems) replacement.push(p);
	if (trailingItem) replacement.push(trailingItem);

	for (const node of replacement) ensureEditableContainers(node);

	const outerOrdered = metadataOf(outer, 'list')?.ordered ?? false;

	// Precompute-before-splice: `$state` wraps entries lazily, so a mutation to a
	// newly-spliced item bypasses reactivity. Only already-proxied items are renumbered
	// after the splice.
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
		// Template the bullet glyph from the enclosing list, so a `*` paste into a `- ` list
		// serializes as one list to reference parsers, not two.
		for (const item of replacement) normalizeItemMarkerToList(item, outer);
	}

	await ctx.controller.commitMultiScope({
		scopes: [{ node: outer, state: outerState, path: plan.listPath }],
		snapshot: ctx.undoEntry === 'join' ? 'skip' : { path: docPathFrom(plan.listPath), offset: 0 },
		mutate: ([scopeView]) => {
			const sharing = scopeView.sharing;
			spliceTerminatedItems(scopeView.children, plan.itemIndex, 1, replacement);

			// Only items AFTER the replacement region: their proxies already exist, so marker
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
			// The shared structural-paste landing rule: last pasted item, before the residue.
			const lastPastedIdx =
				plan.itemIndex + focusIndexBeforeResidue(replacement.length, trailingItem !== null);
			return ctx.controller.landCaret([...plan.listPath, lastPastedIdx], CURSOR_END);
		}
	});
}

// ── Split builder ────────────────────────────────────────────────────────────

/**
 * The leading and trailing items replacing `item` when a paste absorbs at
 * `(innerIndex, offset)`. Either side is null when the caret sits flush against a boundary.
 */
function buildSplitItems(
	item: CstNode,
	innerIndex: number,
	offset: number,
	targetRaw?: string
): { leadingItem: CstNode | null; trailingItem: CstNode | null } {
	if (!item.children) return { leadingItem: null, trailingItem: null };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { leadingItem: null, trailingItem: null };

	const { leadingNode, trailingNode } = splitLeafForPaste(
		targetLeaf,
		offset,
		targetRaw ?? targetLeaf.raw
	);

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
