/**
 * Pure dispatchers for container focus — moveFocus, focusByPath, focusAtColumn.
 * No Svelte context or reactivity; inputs are passed in as parameters.
 */

import type {
	BlockComponent,
	FocusActions,
	FocusPosition,
	StickyColumnDirection
} from '../contracts';
import { CURSOR_END } from '../contracts';
import type { StickyColumnState } from '../cursor/sticky-column';

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

	const isStickyMove = typeof position === 'object' && 'stickyColumnFrom' in position;

	// Vertical-only skip: blocks that hold only widgets contribute no column
	// landing, so ArrowUp/Down passes through to the next block in the same
	// direction. Horizontal moves still stop at the widget edge / select it.
	if (isStickyMove && block.isVerticallyTransparent?.()) {
		const direction = position.stickyColumnFrom === 'below' ? -1 : 1;
		await dispatchMoveFocus(
			refs,
			innerIndex + direction,
			position,
			stickyColumn,
			parent,
			childCount
		);
		return;
	}

	// Horizontal cross-block landing: prefer widget select over a no-op caret
	// at the widget's edge — gives ArrowLeft a single visible step instead of
	// "land on edge, press again to select".
	if (position === 'start' && block.selectEdgeWidget?.('start')) return;
	if (position === 'end' && block.selectEdgeWidget?.('end')) return;

	if (isStickyMove) {
		const x = stickyColumn.get();
		const from = position.stickyColumnFrom;
		if (x !== null && block.focusAtColumn) {
			block.focusAtColumn(x, from);
			return;
		}
		block.focus(from === 'above' ? 0 : CURSOR_END);
		return;
	}

	if (typeof position === 'number') block.focus(position);
	else if (position === 'start') block.focus(0);
	else block.focus(CURSOR_END);
}

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

export function dispatchFocusAtColumn(
	refs: (BlockComponent | undefined)[],
	x: number,
	from: StickyColumnDirection
): void {
	if (refs.length === 0) return;
	if (from === 'above') {
		const first = refs[0];
		if (first?.focusAtColumn) first.focusAtColumn(x, from);
		else first?.focus(0);
	} else {
		const last = refs.length - 1;
		const lastRef = refs[last];
		if (lastRef?.focusAtColumn) lastRef.focusAtColumn(x, from);
		else lastRef?.focus(CURSOR_END);
	}
}
