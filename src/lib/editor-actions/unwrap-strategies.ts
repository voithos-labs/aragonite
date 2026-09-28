/**
 * The Backspace unwrap strategies a container's declared `unwrapRole` selects, run from the
 * container's blockEdit (`docs/design/editor.md` § Container unwrap).
 */

import { CURSOR_END, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { UnwrapRole } from '../schema/block-kind-descriptor';
import {
	deleteNode as performDelete,
	unwrapFirstItemFromList,
	liftFirstChild,
	plainQuote,
	sameContainer,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	isItemUserEmpty
} from '../tree-operations';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsDeps } from './nested/nested-actions';
import { mergedElseFocusPrevious } from './merge-fallback';
import { extendDocPath } from '../cursor/coordinate-spaces';

export interface UnwrapStrategyDeps {
	deps: NestedActionsDeps;
	state: BlockListState;
}

/** Drop an empty item and renumber from its index; `land` places the caret where the
 *  strategy chose. */
async function deleteEmptyItem(
	{ deps, state }: UnwrapStrategyDeps,
	itemIndex: number,
	land: () => void
): Promise<boolean> {
	return deps.parent.containerEdit.commitContainer({
		containerNode: deps.node,
		path: deps.path,
		state,
		snapshot: { path: extendDocPath(deps.path, itemIndex), offset: 0 },
		mutate: (scope) => {
			const change = performDelete(scope.body, itemIndex, deps.reading.grammar, scope.sharing);
			renumberOrderedList(scope.node, itemIndex, scope.sharing);
			return change;
		},
		op: { kind: 'delete', eventPath: extendDocPath(deps.path, itemIndex) },
		afterTick: land
	});
}

// ── First-child strategies ──────────────────────────────────────────────────

/** Lift the first child out of a quote-shaped container, whose opener goes with it (U2). */
async function liftFirstChildDroppingOpener({ deps }: UnwrapStrategyDeps): Promise<boolean> {
	return spliceLift(deps, liftFirstChild(deps.node, plainQuote));
}

/** Lift the first child out of a container whose syntax survives, so the rest keeps its kind (U2). */
async function liftFirstChildAndKeepContainer({ deps }: UnwrapStrategyDeps): Promise<boolean> {
	return spliceLift(deps, liftFirstChild(deps.node, sameContainer));
}

/** Leaves the tree alone: child 0 is the container's title row, and a lift would carry it out. */
async function keepReservedChrome(): Promise<boolean> {
	return false;
}

async function spliceLift(deps: NestedActionsDeps, replacement: CstNode[]): Promise<boolean> {
	if (replacement.length === 0) return false;
	return deps.parent.blockEdit.replaceBlock(deps.index, replacement, {
		replacementIndex: 0,
		offset: 0
	});
}

/** The first list item: promote if nested, delete if empty, delete the list if it is the only
 *  item, else unwrap its first paragraph before the list (U1). */
async function listItemCascadeFirst(strategy: UnwrapStrategyDeps): Promise<boolean> {
	const { deps, state } = strategy;
	const node = deps.node;
	const index = deps.index;
	if (!node.children) return false;

	if (deps.parentListContext) {
		return deps.parentListContext.promoteNestedItem(
			deps.parentListContext.getContainingItemIndex(),
			node,
			0
		);
	}

	const item = node.children[0];
	const firstChildEmpty = isItemUserEmpty(item);

	if (firstChildEmpty && node.children.length > 1) {
		return deleteEmptyItem(strategy, 0, () => {
			state.innerBlockRefs[0]?.focus(CURSOR_START);
		});
	}
	if (firstChildEmpty) {
		const deleted = await deps.parent.blockEdit.deleteBlock(index);
		await deps.parent.focus.moveFocus(index - 1, 'end');
		return deleted;
	}
	const replacement = unwrapFirstItemFromList(node);
	if (replacement.length === 0) return false;
	return deps.parent.blockEdit.replaceBlock(index, replacement, {
		replacementIndex: 0,
		offset: 0
	});
}

// ── Middle-child strategies ─────────────────────────────────────────────────

/** A middle list item: delete and renumber if empty, else merge into the deepest text above (M1). */
async function listItemCascadeMiddle(
	strategy: UnwrapStrategyDeps,
	itemIndex: number
): Promise<boolean> {
	const { deps, state } = strategy;
	const node = deps.node;
	if (!node.children) return false;

	const item = node.children[itemIndex];
	if (isItemUserEmpty(item)) {
		return deleteEmptyItem(strategy, itemIndex, () => {
			state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
		});
	}

	// A previous leaf with no editable text gives the merge no target, so only the caret moves.
	let mergePoint: { targetPath: number[]; offset: number } | null = null;
	return deps.parent.containerEdit.commitContainer({
		containerNode: node,
		path: deps.path,
		state,
		snapshot: { path: extendDocPath(deps.path, itemIndex), offset: 0 },
		mutate: (scope) => {
			const result = mergeListItemIntoPrevious(
				scope.node,
				scope.children,
				itemIndex,
				scope.sharing,
				deps.reading
			);
			mergePoint = result?.mergePoint ?? null;
			return mergePoint ? { op: 'delete', at: itemIndex, count: 1 } : { op: 'noop' };
		},
		op: {
			kind: 'merge',
			detail: { direction: 'prev' },
			eventPath: extendDocPath(deps.path, itemIndex)
		},
		afterTick: () => {
			const merged = mergedElseFocusPrevious(mergePoint, state.innerBlockRefs[itemIndex - 1]);
			if (!merged) return;
			const [firstPathIdx, ...restPath] = merged.targetPath;
			state.innerBlockRefs[firstPathIdx]?.focusByPath?.(restPath, merged.offset);
		},
		// A merge with no target changes nothing; discard the undo entry but keep afterTick,
		// which still places the caret.
		discardIfNoop: true
	});
}

// ── Registries (selected by UnwrapRole names) ───────────────────────────────

export const firstChildUnwrapStrategies: Record<
	UnwrapRole['firstChildBackspace'],
	(deps: UnwrapStrategyDeps) => Promise<boolean>
> = {
	'lift-first-child-drop-opener': liftFirstChildDroppingOpener,
	'lift-first-child-keep-container': liftFirstChildAndKeepContainer,
	'keep-reserved-chrome': keepReservedChrome,
	'list-item-cascade': listItemCascadeFirst
};

export const middleChildUnwrapStrategies: Record<
	'list-item-cascade',
	(deps: UnwrapStrategyDeps, innerIndex: number) => Promise<boolean>
> = {
	'list-item-cascade': listItemCascadeMiddle
};
