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
import { stampStructuralChange, type StructuralChange } from '../structural-change';
import { renumberOrderedList, templatePastedItemMarkers } from '../list/ordered-markers';
import { spliceTerminatedItems } from '../list/terminator';
import { containerScopeState } from './parent-scope';
import { buildSplitItems } from '../list/list-builders';
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

	templatePastedItemMarkers(replacement, outer, plan.itemIndex);

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
