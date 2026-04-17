/**
 * Pure dispatchers for container focus operations. Each container component
 * currently inlines an identical copy of these three functions; they live
 * here so containers can call them instead.
 *
 * None of these functions touch Svelte context or reactivity directly —
 * they take the inputs they need (refs, parent actions, sticky column state)
 * as parameters. Pure logic, unit-testable in isolation.
 */

import type { BlockComponent, FocusActions, FocusPosition, StickyColumnDirection } from '../../../contracts';
import { CURSOR_END } from '../../../contracts';
import type { StickyColumnState } from '../../../contenteditable/sticky-column';

/**
 * Move focus within a container's inner children, or delegate upward to
 * the parent when the target index is out of range. Handles numeric offsets,
 * 'start'/'end' positions, and the sticky-column variant.
 */
export async function dispatchMoveFocus(
	refs: (BlockComponent | undefined)[],
	innerIndex: number,
	position: FocusPosition,
	stickyColumn: StickyColumnState,
	parent: { focus: FocusActions; index: number }
): Promise<void> {
	if (innerIndex < 0) {
		await parent.focus.moveFocus(parent.index - 1, position);
		return;
	}
	if (innerIndex >= refs.length) {
		await parent.focus.moveFocus(parent.index + 1, position);
		return;
	}

	const block = refs[innerIndex];
	if (!block?.focusable) return;

	if (typeof position === 'object' && 'stickyColumnFrom' in position) {
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

/**
 * Cascade focus down a path of child indices inside a container. Peels
 * path[0], delegates to the child at that index via focus(offset) if the
 * path ends here, or recursively via focusByPath?(rest, offset) if further
 * descent is needed. Used by cross-container merge and M1 merge target
 * cascades.
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
 * Position the cursor at the editor-relative pixel X inside a container's
 * first (from='above') or last (from='below') inner child. Delegates to
 * the chosen child's focusAtColumn? if available, else falls back to
 * focus(0) / focus(CURSOR_END).
 */
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
