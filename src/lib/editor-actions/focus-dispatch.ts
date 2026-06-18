/**
 * Pure dispatchers for container focus — moveFocus, focusByPath, focusAtColumn.
 * No Svelte context or reactivity; inputs are passed in as parameters.
 */

import type { FocusActions } from '../action-contracts';
import {
	CURSOR_END,
	type BlockComponent,
	type FocusPosition,
	type StickyColumnDirection
} from '../block-component';
import type { StickyColumnState } from '../cursor/sticky-column';
import { consumeStickyLanding } from './focus-landing';

/**
 * Move focus within a container, or delegate upward when out of range.
 *
 * `childCount`, when supplied, overrides `refs.length` for the upper-bound
 * guard. Pass `node.children.length` from containers whose child count can
 * diverge from `refs.length` for one render cycle after a structural op
 * (bind:this fires asynchronously). Without it, delegation fires prematurely
 * and the cursor escapes the container.
 */
export async function dispatchMoveFocus(
	refs: (BlockComponent | undefined)[],
	innerIndex: number,
	position: FocusPosition,
	stickyColumn: StickyColumnState,
	parent: { focus: FocusActions; index: number },
	childCount?: number
): Promise<void> {
	if (innerIndex < 0) {
		await parent.focus.moveFocus(parent.index - 1, position);
		return;
	}
	const upperBound = childCount ?? refs.length;
	if (innerIndex >= upperBound) {
		await parent.focus.moveFocus(parent.index + 1, position);
		return;
	}

	const block = refs[innerIndex];
	if (!block?.focusable) return;

	await consumeStickyLanding(block, innerIndex, position, stickyColumn, (i) =>
		dispatchMoveFocus(refs, i, position, stickyColumn, parent, childCount)
	);
}

/**
 * Adjacent-only contract: `focusByPath` is sync and does NOT reveal an
 * off-window head, so an unmounted `refs[first]` silently no-ops. Every caller
 * (merge-into-previous, deep-leaf merge) lands on a block adjacent to a mounted
 * caret, i.e. within overscan of the pinned focus index → mounted. A far
 * (>overscan) head under windowing would no-op the caret — VR-12, latent and
 * not currently reachable. A future far caller must route through `revealByPath`
 * first (the async sibling, which scrolls + mounts).
 */
export function dispatchFocusByPath(
	refs: (BlockComponent | undefined)[],
	path: number[],
	offset: number
): void {
	if (path.length === 0) {
		refs[0]?.focus(offset);
		return;
	}
	const [first, ...rest] = path;
	const child = refs[first];
	if (!child) return;
	if (rest.length === 0) {
		child.focus(offset);
	} else {
		child.focusByPath?.(rest, offset);
	}
}

/**
 * Walk a path through nested container refs and return the BlockComponent
 * at the leaf. Used by cross-block focus extension to consult component
 * predicates (e.g. `isVerticallyTransparent`) by path.
 */
export function dispatchGetBlockComponentByPath(
	refs: (BlockComponent | undefined)[],
	path: number[]
): BlockComponent | null {
	if (path.length === 0) return null;
	const [first, ...rest] = path;
	const child = refs[first];
	if (!child) return null;
	if (rest.length === 0) return child;
	return child.getBlockComponentByPath?.(rest) ?? null;
}

export function dispatchFocusAtColumn(
	refs: (BlockComponent | undefined)[],
	x: number,
	from: StickyColumnDirection
): void {
	if (refs.length === 0) return;
	const indices =
		from === 'above' ? refs.map((_, i) => i) : refs.map((_, i) => refs.length - 1 - i);
	// Skip vertically-transparent refs so a container entered from above/below
	// lands focus on its first/last text-bearing child rather than getting stuck
	// in an image-only paragraph.
	for (const i of indices) {
		const ref = refs[i];
		if (!ref?.focusable) continue;
		if (ref.isVerticallyTransparent?.()) continue;
		if (ref.focusAtColumn) ref.focusAtColumn(x, from);
		else ref.focus(from === 'above' ? 0 : CURSOR_END);
		return;
	}
}
