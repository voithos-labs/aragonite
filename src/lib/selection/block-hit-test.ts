/**
 * Finds the block under a viewport point for pointer hit-testing. The hit carries the
 * point-to-cell hooks the block's kind descriptor declares, so a caller can resolve a table
 * cell without knowing the kind, and it reports no text element for a block that has none.
 */

import type { AnyBlockKind } from '../core/nodes';
import { WHOLE_BLOCK_INPUT_ATTR } from '../editor-actions/whole-block-focus-surface';
import { tryGetBlockKindDescriptor, type CaretTarget } from '../schema/block-kind-descriptor';
import type { CellSelectionPoint, SelectionEndpoint } from './primitives';
import { offsetFromViewportPoint } from '../cursor/point-offset';
import { readBlockPath } from './path-lookup';

export interface BlockHit {
	path: number[];
	/**
	 * The editable element a character offset is hit-tested against, or null when the kind has
	 * none (a table grid, or a whole-block kind whose body is all markers and buttons).
	 * Hit-testing the wrapper instead would return a plausible but wrong offset, not a refusal.
	 */
	charSurface: HTMLElement | null;
	/**
	 * Maps a point to a row-major cell index for a grid kind such as a table. Bound to this
	 * block's wrapper, taken from the kind descriptor.
	 */
	foreignDragHitTest?: (clientX: number, clientY: number) => number | null;
	/**
	 * Where a click inside a grid kind puts the caret, as a child path plus offset; read when
	 * the drag hook returns null.
	 */
	caretTargetAtPoint?: (clientX: number, clientY: number) => CaretTarget | null;
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
			// `tryGet` tolerates an unregistered kind string read off the DOM.
			const descriptor = kind ? tryGetBlockKindDescriptor(kind as AnyBlockKind) : undefined;
			const dragHitTest = descriptor?.foreignDragHitTest;
			const caretTarget = descriptor?.caretTargetAtPoint;
			return {
				path,
				// A grid kind's first contenteditable is a cell, not the block, so a kind with the
				// drag hook reports no text element. The whole-block input and the selection
				// overlay are skipped for the same reason: neither holds the block's characters.
				charSurface: dragHitTest
					? null
					: (wrapper.querySelector(
							`[contenteditable]:not([${WHOLE_BLOCK_INPUT_ATTR}]):not(.selection-overlay)`
						) as HTMLElement | null),
				foreignDragHitTest: dragHitTest && ((cx, cy) => dragHitTest(wrapper, cx, cy)),
				caretTargetAtPoint: caretTarget && ((cx, cy) => caretTarget(wrapper, cx, cy))
			};
		}
		el = el.parentElement;
	}
	return null;
}

/**
 * The selection endpoint a pointer over `hit` addresses: a cell index for a grid kind, a
 * character offset where the block has text, and otherwise the whole block, whose end is
 * chosen later against the other endpoint. Both drag paths use this, so neither can hit-test
 * characters against a block that has none.
 */
export function endpointAtPoint(
	hit: BlockHit,
	clientX: number,
	clientY: number
): SelectionEndpoint | null {
	if (hit.foreignDragHitTest) {
		const cellIdx = hit.foreignDragHitTest(clientX, clientY);
		// `cellCoordinate` routes a collapse and a scroll-into-view to the cell itself, as the
		// keyboard path does.
		return cellIdx === null
			? null
			: ({ path: hit.path, offset: cellIdx, cellCoordinate: true } satisfies CellSelectionPoint);
	}
	if (!hit.charSurface) return { path: hit.path, wholeBlock: true };
	const offset = offsetFromViewportPoint(hit.charSurface, clientX, clientY);
	return offset === null ? null : { path: hit.path, offset };
}
