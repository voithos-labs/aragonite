/**
 * Pure dispatchers for container focus — moveFocus, focusByPath, focusAtColumn.
 * No Svelte context or reactivity; inputs are passed in as parameters.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import {
	CURSOR_END,
	type BlockComponent,
	type FocusPosition,
	type StickyColumnDirection
} from '../../block-component';
import type { StickyColumnState } from '../../cursor/sticky-column';
import { consumeStickyLanding } from './focus-landing';

/** What the calling scope contributes to a move beyond the target itself. */
export interface MoveFocusDispatch {
	/** Overrides `refs.length` for the upper bound: the two diverge for one render cycle
	 *  after a structural op, and without it the cursor escapes the container. */
	childCount?: number;
	/** The caller's own options, forwarded verbatim on upward delegation. */
	options?: MoveFocusOptions;
	/** Pre-bound to this scope's own boundaries (`selection/gap-caret.ts`). */
	gapStop?: (boundaryIndex: number) => boolean;
}

/** Move focus within a container, or delegate upward when out of range. */
export async function dispatchMoveFocus(
	refs: (BlockComponent | undefined)[],
	innerIndex: number,
	position: FocusPosition,
	stickyColumn: StickyColumnState,
	parent: { focus: FocusActions; index: number },
	dispatch: MoveFocusDispatch = {}
): Promise<void> {
	const { childCount, options, gapStop } = dispatch;
	// Omit the options arg when unset so the common path stays a two-arg call.
	const delegate = (targetIndex: number) =>
		options
			? parent.focus.moveFocus(targetIndex, position, options)
			: parent.focus.moveFocus(targetIndex, position);
	const step = traversalStep(position);
	// Ahead of every ref read, so the CST alone decides the boundary and a windowed-out
	// child cannot change the answer. The two scope edges are boundaries like any other:
	// this is also what stops the delegate arms from leaving the container.
	if (gapStop && step !== 0 && !options?.skipGapStop) {
		if (gapStop(step > 0 ? innerIndex : innerIndex + 1)) return;
	}
	if (innerIndex < 0) {
		await delegate(parent.index - 1);
		return;
	}
	const upperBound = childCount ?? refs.length;
	if (innerIndex >= upperBound) {
		await delegate(parent.index + 1);
		return;
	}

	const block = refs[innerIndex];
	if (!block?.focusable) {
		// A refless or non-focusable child must not dead-end the move — continue in
		// its direction (editor.md § Focus Traversal).
		if (step !== 0) {
			await dispatchMoveFocus(refs, innerIndex + step, position, stickyColumn, parent, dispatch);
		}
		return;
	}

	await consumeStickyLanding(block, innerIndex, position, stickyColumn, (i) =>
		dispatchMoveFocus(refs, i, position, stickyColumn, parent, dispatch)
	);
}

/**
 * Direction a FocusPosition implies for traversal. A bare numeric offset is a
 * targeted landing with no direction, so 0 tells the caller not to skip.
 */
export function traversalStep(position: FocusPosition): -1 | 0 | 1 {
	if (typeof position === 'object') return position.stickyColumnFrom === 'below' ? -1 : 1;
	if (position === 'start') return 1;
	if (position === 'end') return -1;
	return 0;
}

/**
 * Adjacent-only contract (VR-12, docs/design/virtual-rendering.md): sync, revealing
 * nothing, so an unmounted `refs[first]` silently no-ops. The caller keeps the target
 * within overscan; anything wider routes through the async `revealByPath`/`revealPath`.
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

/** Null when the path doesn't resolve to a mounted ref. */
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
	// Skip vertically-transparent refs so an entry from above/below lands on the
	// first/last text-bearing child, not an image-only paragraph.
	for (const i of indices) {
		const ref = refs[i];
		if (!ref?.focusable) continue;
		if (ref.isVerticallyTransparent?.()) continue;
		if (ref.focusAtColumn) ref.focusAtColumn(x, from);
		else ref.focus(from === 'above' ? 0 : CURSOR_END);
		return;
	}
}
