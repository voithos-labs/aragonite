/**
 * Viewport point to the block under it, for pointer hit-testing: walks ancestors of the topmost
 * element to the nearest `data-block-path` host. A kind with internal coordinate addressing
 * carries the point→internals hooks its descriptor declares, so a caller resolves a
 * cell-coordinate point without knowing the kind. What the hit does NOT carry is what a kind
 * cannot answer: a block with no character surface reports none.
 */

import type { AnyBlockKind } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CellSelectionPoint, SelectionEndpoint } from './primitives';
import { offsetFromViewportPoint } from './native-bridge';
import { readBlockPath } from './path-lookup';

export interface BlockHit {
	path: number[];
	/**
	 * The surface a character offset may be hit-tested against, or null when the kind renders
	 * none: a coordinate-addressed grid, and a whole-block kind whose rendered body is chrome.
	 * A caller that character-hit-tests the wrapper instead gets a plausible-but-wrong offset
	 * across the whole subtree rather than a decline.
	 */
	charSurface: HTMLElement | null;
	/**
	 * Point→internal-offset hook for kinds with coordinate addressing (a table's row-major
	 * cellIdx). Pre-bound to the block's wrapper, resolved from the kind descriptor.
	 */
	foreignDragHitTest?: (clientX: number, clientY: number) => number | null;
	/**
	 * The caret landing inside such a kind, as an internal child path plus offset. A
	 * caret-placing gesture reads this where the drag hook declines.
	 */
	caretTargetAtPoint?: (
		clientX: number,
		clientY: number
	) => { path: number[]; offset: number } | null;
}

export function blockAtPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): BlockHit | null {
	let el: Element | null = document.elementFromPoint(clientX, clientY);
	while (el && el !== editorRoot) {
		if (el instanceof HTMLElement && el.getAttribute('data-block-path')) {
			const path = readBlockPath(el);
			if (!path) return null;
			const wrapper = el;
			const kind = wrapper.getAttribute('data-block-kind');
			// tryGet tolerates junk DOM strings — unregistered kinds resolve undefined.
			const descriptor = kind ? tryGetBlockKindDescriptor(kind as AnyBlockKind) : undefined;
			const dragHitTest = descriptor?.foreignDragHitTest;
			const caretTarget = descriptor?.caretTargetAtPoint;
			return {
				path,
				// A cell-addressed kind's first contenteditable is one of its CELLS, so declaring
				// the drag hook withdraws the block-level surface rather than offering that.
				charSurface: dragHitTest
					? null
					: (wrapper.querySelector('[contenteditable]') as HTMLElement | null),
				foreignDragHitTest: dragHitTest && ((cx, cy) => dragHitTest(wrapper, cx, cy)),
				caretTargetAtPoint: caretTarget && ((cx, cy) => caretTarget(wrapper, cx, cy))
			};
		}
		el = el.parentElement;
	}
	return null;
}

/**
 * The selection endpoint a pointer over `hit` addresses: a row-major cell index where the kind
 * declares the drag hook, a char offset on a character surface, and otherwise the block as a
 * whole — the selection funnel resolves which of its two ends this side of the range wants.
 * Shared by both drag consumers, so neither can hit-test characters against a block with none.
 */
export function endpointAtPoint(
	hit: BlockHit,
	clientX: number,
	clientY: number
): SelectionEndpoint | null {
	if (hit.foreignDragHitTest) {
		const cellIdx = hit.foreignDragHitTest(clientX, clientY);
		// The flag routes collapse/reveal to the deep cell, matching the keyboard path.
		return cellIdx === null
			? null
			: ({ path: hit.path, offset: cellIdx, cellCoordinate: true } satisfies CellSelectionPoint);
	}
	if (!hit.charSurface) return { path: hit.path, wholeBlock: true };
	const offset = offsetFromViewportPoint(hit.charSurface, clientX, clientY);
	return offset === null ? null : { path: hit.path, offset };
}
