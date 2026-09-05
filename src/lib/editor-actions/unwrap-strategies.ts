/**
 * Unwrap strategy implementations, selected by a container's declared
 * `unwrapRole` (schema/block-kind-descriptor.ts) from the nested blockEdit
 * dispatcher.
 */

import { CURSOR_END, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { UnwrapRole } from '../schema/block-kind-descriptor';
import {
	deleteNode as performDelete,
	unwrapFirstItemFromList,
	unwrapFirstChildFromQuote,
	liftFirstChildKeepingContainer,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	isItemUserEmpty
} from '../tree-operations';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsDeps } from './nested/nested-actions';
import { mergedElseFocusPrevious } from './merge-fallback';
import { scopeParentOf } from './block-edit-scope';
import { extendDocPath } from '../cursor/coordinate-spaces';

export interface UnwrapStrategyDeps {
	deps: NestedActionsDeps;
	state: BlockListState;
}

/** Drop a user-empty item and renumber from its slot; `land` seats the caret the strategy chose. */
async function deleteEmptyItem(
	{ deps, state }: UnwrapStrategyDeps,
	itemIndex: number,
	land: () => void
): Promise<void> {
	await deps.parent.containerEdit.commitContainer({
		containerNode: deps.node,
		path: deps.path,
		state,
		snapshot: { path: extendDocPath(deps.path, itemIndex), offset: 0 },
		mutate: (scope) => {
			const change = performDelete(scopeParentOf(scope), itemIndex, scope.sharing);
			renumberOrderedList(scope.node, itemIndex, scope.sharing);
			return change;
		},
		op: { kind: 'delete', eventPath: extendDocPath(deps.path, itemIndex) },
		afterTick: land
	});
}

// ── First-child strategies ──────────────────────────────────────────────────

/** Rule U2 for the quote shape: the opener lives on the first line, so the lift drops it. */
async function liftFirstChildDroppingOpener({ deps }: UnwrapStrategyDeps): Promise<void> {
	await spliceLift(deps, unwrapFirstChildFromQuote(deps.node));
}

/** Rule U2 for a container whose syntax survives the lift: the remainder keeps its kind. */
async function liftFirstChildAndKeepContainer({ deps }: UnwrapStrategyDeps): Promise<void> {
	await spliceLift(deps, liftFirstChildKeepingContainer(deps.node));
}

/** Rule U2's declared decline: child 0 is the container's chrome, and a lift would carry it out. */
async function keepReservedChrome(): Promise<void> {}

async function spliceLift(deps: NestedActionsDeps, replacement: CstNode[]): Promise<void> {
	if (replacement.length === 0) return;
	await deps.parent.blockEdit.replaceBlock(deps.index, replacement, {
		replacementIndex: 0,
		offset: 0
	});
}

/** List first-item cascade: nested promote / empty delete / empty-sole delete-list / Rule U1. */
async function listItemCascadeFirst(strategy: UnwrapStrategyDeps): Promise<void> {
	const { deps, state } = strategy;
	const node = deps.node;
	const index = deps.index;
	if (!node.children) return;

	if (deps.parentListContext) {
		await deps.parentListContext.promoteNestedItem(
			deps.parentListContext.getContainingItemIndex(),
			node,
			0
		);
		return;
	}

	const item = node.children[0];
	const firstChildEmpty = isItemUserEmpty(item);

	if (firstChildEmpty && node.children.length > 1) {
		await deleteEmptyItem(strategy, 0, () => {
			state.innerBlockRefs[0]?.focus(CURSOR_START);
		});
	} else if (firstChildEmpty && node.children.length === 1) {
		await deps.parent.blockEdit.deleteBlock(index);
		await deps.parent.focus.moveFocus(index - 1, 'end');
	} else {
		const replacement = unwrapFirstItemFromList(node);
		if (replacement.length === 0) return;
		await deps.parent.blockEdit.replaceBlock(index, replacement, {
			replacementIndex: 0,
			offset: 0
		});
	}
}

// ── Middle-child strategies ─────────────────────────────────────────────────

/** List middle-item: empty delete+renumber, else Rule M1 merge into deepest text above. */
async function listItemCascadeMiddle(
	strategy: UnwrapStrategyDeps,
	itemIndex: number
): Promise<void> {
	const { deps, state } = strategy;
	const node = deps.node;
	if (!node.children) return;

	const item = node.children[itemIndex];
	if (isItemUserEmpty(item)) {
		await deleteEmptyItem(strategy, itemIndex, () => {
			state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
		});
		return;
	}

	// Rule M1: merge into the deepest visible text above. An opaque prev leaf gives
	// the merge no target, so the tree stays put and the caret falls back.
	let mergePoint: { targetPath: number[]; offset: number } | null = null;
	await deps.parent.containerEdit.commitContainer({
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
				deps.getPresentationMode?.(),
				deps.linkRef
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
		// A no-target merge changes nothing; discard the entry but keep afterTick,
		// which still lands the caret.
		discardIfNoop: true
	});
}

// ── Registries (selected by UnwrapRole names) ───────────────────────────────

export const firstChildUnwrapStrategies: Record<
	UnwrapRole['firstChildBackspace'],
	(deps: UnwrapStrategyDeps) => Promise<void>
> = {
	'lift-first-child-drop-opener': liftFirstChildDroppingOpener,
	'lift-first-child-keep-container': liftFirstChildAndKeepContainer,
	'keep-reserved-chrome': keepReservedChrome,
	'list-item-cascade': listItemCascadeFirst
};

export const middleChildUnwrapStrategies: Record<
	'list-item-cascade',
	(deps: UnwrapStrategyDeps, innerIndex: number) => Promise<void>
> = {
	'list-item-cascade': listItemCascadeMiddle
};
