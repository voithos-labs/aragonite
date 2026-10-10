/**
 * Pure dispatchers for focus across a block list: moveFocus for the root and every container,
 * and focusByPath and focusAtColumn inside a container. Everything comes in as parameters.
 */

import type { FocusActions, MoveFocusOptions } from '../../action-contracts';
import {
	CURSOR_END,
	CURSOR_START,
	type BlockComponent,
	type FocusPosition,
	type StickyColumnDirection
} from '../../block-component';
import type { CaretMemory } from '../../caret/caret-memory';
import { consumeStickyLanding, verticalArrival } from './focus-landing';

/** One block list's side of a focus move, the root's or a container's. */
export interface MoveFocusScope {
	/** The child count from the tree: the mounted refs lag a structural edit by a render. */
	count(): number;
	/** Child `index`'s component, scrolled into the mounted range first if it's windowed out. */
	mount(index: number): Promise<BlockComponent | null>;
	/** A move before the first child (-1) or past the last (1): a container hands it to its
	 *  parent, the root stops or appends a paragraph. */
	leave(step: -1 | 1, position: FocusPosition, options?: MoveFocusOptions): Promise<void>;
	/** Bound to this list's own boundaries (`selection/gap-caret.ts`). */
	gapStop(boundaryIndex: number): boolean;
	/** The move ended on child `index`: its focus call scrolled nothing, so this may. */
	arrived(index: number): void;
}

/** The one focus traversal, run by the root and by every container over its own list. */
export async function dispatchMoveFocus(
	scope: MoveFocusScope,
	index: number,
	position: FocusPosition,
	caretMemory: Pick<CaretMemory, 'column'>,
	options?: MoveFocusOptions
): Promise<void> {
	const step = traversalStep(position);
	// Before any ref is read, so the tree alone decides the boundary; the list's own edges are
	// boundaries too, which keeps the move from leaving it.
	if (step !== 0 && !options?.skipGapStop && scope.gapStop(step > 0 ? index : index + 1)) return;
	if (index < 0 || index >= scope.count()) {
		await scope.leave(index < 0 ? -1 : 1, position, options);
		return;
	}

	const block = await scope.mount(index);
	const retry = (i: number) => dispatchMoveFocus(scope, i, position, caretMemory, options);
	if (!block?.focusable) {
		// A child that can't take focus must not stop the move: continue in its direction
		// (`docs/design/editor.md` § Focus traversal).
		if (step !== 0) await retry(index + step);
		return;
	}
	await consumeStickyLanding(block, index, position, caretMemory, retry);
	scope.arrived(index);
}

/** A move handed to `focus`, with the options argument left off when there are none, so the
 *  common call keeps two arguments. */
export function delegateMoveFocus(
	focus: Pick<FocusActions, 'moveFocus'>,
	index: number,
	position: FocusPosition,
	options?: MoveFocusOptions
): void | Promise<void> {
	return options ? focus.moveFocus(index, position, options) : focus.moveFocus(index, position);
}

/**
 * The direction a FocusPosition implies for traversal. A bare numeric offset is a targeted
 * position with no direction, so 0 tells the caller not to skip.
 */
export function traversalStep(position: FocusPosition): -1 | 0 | 1 {
	if (typeof position === 'object') return position.stickyColumnFrom === 'below' ? -1 : 1;
	if (position === 'start') return 1;
	if (position === 'end') return -1;
	return 0;
}

/** Scrolls nothing into view, so an unmounted target does nothing; a caller that cannot keep
 *  the target mounted goes through `block-lists/child-list.ts :: descendTo`. */
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
	const indices =
		from === 'above' ? refs.map((_, i) => i) : refs.map((_, i) => refs.length - 1 - i);
	// Pass over widget-only children so an entry from above or below lands on the first or
	// last child that has text.
	for (const i of indices) {
		const ref = refs[i];
		if (!ref?.focusable) continue;
		const arrival = verticalArrival(ref, from);
		if (arrival === 'entered') return;
		if (arrival === 'transparent') continue;
		if (ref.focusAtColumn) ref.focusAtColumn(x, from);
		else ref.focus(from === 'above' ? CURSOR_START : CURSOR_END);
		return;
	}
}
