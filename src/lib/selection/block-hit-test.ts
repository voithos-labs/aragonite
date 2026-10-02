/**
 * Finds the block under a viewport point for pointer hit-testing. The hit carries the
 * point-to-cell hooks the block's kind descriptor declares, so a caller can resolve a table
 * cell without knowing the kind, and it reports no text element for a block that has none.
 */

import type { AnyBlockKind } from '../core/nodes';
import { WHOLE_BLOCK_INPUT_ATTR } from '../editor-actions/whole-block-focus-surface';
import { tryGetBlockKindDescriptor, type CaretTarget } from '../schema/block-kind-descriptor';
import { cellPoint, type SelectionEndpoint } from './primitives';
import { caretOffsetAtPoint, offsetFromViewportPoint } from '../cursor/point-offset';
import { readBlockPath } from './path-lookup';
import { pathsEqual } from './path-math';

export interface BlockHit {
	path: number[];
	/** The element carrying the block's path; a container's children are block hosts inside it. */
	host: HTMLElement;
	/** The editable element a character offset is hit-tested against, or null when the kind has
	 *  none: hit-testing the wrapper instead returns a plausible but wrong offset. */
	charSurface: HTMLElement | null;
	/** Maps a point to a row-major cell index for a grid kind such as a table. */
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
				host: wrapper,
				// A grid kind's first contenteditable is a cell, not the block; the whole-block
				// input and the selection overlay hold none of the block's characters either.
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

/** Whether the hit's editable text belongs to the block itself, not to a child inside it (a
 *  quote's first line is its first child's). False where editing is off, as in reading mode. */
export function holdsOwnText(hit: BlockHit): boolean {
	const surface = hit.charSurface;
	if (!surface?.matches('[contenteditable="true"]')) return false;
	const owner = readBlockPath(surface.closest('[data-block-path]'));
	return owner !== null && pathsEqual(owner, hit.path);
}

/** The selection endpoint a pointer over `hit` addresses. A block with no text yields the whole
 *  block, so no drag hit-tests characters against it; its end is chosen against the other end. */
export function endpointAtPoint(
	hit: BlockHit,
	clientX: number,
	clientY: number
): SelectionEndpoint | null {
	if (hit.foreignDragHitTest) {
		const cellIdx = hit.foreignDragHitTest(clientX, clientY);
		// A cell point's `cellCoordinate` routes a collapse and a scroll-into-view to the cell
		// itself, as the keyboard path does.
		return cellIdx === null ? null : cellPoint(hit.path, cellIdx);
	}
	if (!hit.charSurface) return { path: hit.path, wholeBlock: true };
	// A block's own text answers a point on its frame as a click there does; a container's first
	// child's text answers only a point on it.
	const offset = holdsOwnText(hit)
		? caretOffsetAtPoint(hit.charSurface, clientX, clientY)
		: offsetFromViewportPoint(hit.charSurface, clientX, clientY);
	return offset === null ? null : { path: hit.path, offset };
}
