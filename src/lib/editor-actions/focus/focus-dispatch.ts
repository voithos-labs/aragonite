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

/**
 * Move focus within a container, or delegate upward when out of range.
 *
 * `childCount`, when supplied, overrides `refs.length` for the upper-bound
 * guard. Pass `node.children.length` from containers whose child count can
 * diverge from `refs.length` for one render cycle after a structural op
 * (bind:this fires asynchronously). Without it, delegation fires prematurely
 * and the cursor escapes the container.
 *
 * `options` propagates upward unchanged so a flag like `append: false` reaches
 * the root, where the past-end append actually lives.
 */
export async function dispatchMoveFocus(
	refs: (BlockComponent | undefined)[],
	innerIndex: number,
	position: FocusPosition,
	stickyColumn: StickyColumnState,
	parent: { focus: FocusActions; index: number },
	childCount?: number,
	options?: MoveFocusOptions
): Promise<void> {
	// Omit the options arg when unset so the common path stays a two-arg call.
	const delegate = (targetIndex: number) =>
		options
			? parent.focus.moveFocus(targetIndex, position, options)
			: parent.focus.moveFocus(targetIndex, position);
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
		// A refless (failed-render) or non-focusable child must not dead-end the
		// move — continue in its direction (editor.md § Focus Traversal). The
		// recursion delegates upward when it walks past this scope's bounds.
		const step = traversalStep(position);
		if (step !== 0) {
			await dispatchMoveFocus(
				refs,
				innerIndex + step,
				position,
				stickyColumn,
				parent,
				childCount,
				options
			);
		}
		return;
	}

	await consumeStickyLanding(block, innerIndex, position, stickyColumn, (i) =>
		dispatchMoveFocus(refs, i, position, stickyColumn, parent, childCount, options)
	);
}

/**
 * Direction a FocusPosition implies for traversal: entering at 'start' (or
 * from above) means the move goes down; entering at 'end' (or from below)
 * means up. A bare numeric offset is a targeted landing with no direction —
 * 0 tells the caller not to skip.
 */
export function traversalStep(position: FocusPosition): -1 | 0 | 1 {
	if (typeof position === 'object') return position.stickyColumnFrom === 'below' ? -1 : 1;
	if (position === 'start') return 1;
	if (position === 'end') return -1;
	return 0;
}

/**
 * Adjacent-only contract: `focusByPath` is sync and does NOT reveal an
 * off-window head, so an unmounted `refs[first]` silently no-ops. The
 * precondition is the CALLER's, not this function's: the target must be within
 * overscan of the pinned focus index. A caller whose target index can scale
 * with anything other than caret distance (a clipboard item count, say) must
 * route through `revealByPath`/`revealPath` instead — the async siblings, which
 * scroll + mount. VR-12 (docs/design/virtual-rendering.md § VR Identifier
 * Catalog). Auditing "the callers" against that bound is what let VR-12 hide:
 * the enumeration was of this file's importers, and the reachable violation
 * lived a layer away. Bound the LANDING, not the caller list.
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
 * Walk a path through nested container refs and return the BlockComponent at
 * the leaf, or null if the path doesn't resolve to a mounted ref. Backs the
 * container shim's `getBlockComponentByPath`, through which path-based
 * component lookup descends nested containers.
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
