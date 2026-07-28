/**
 * Viewport point → the block under it, for drag hit-testing. Walks ancestors of
 * the topmost element to the nearest `data-block-path` host; a kind with
 * internal coordinate addressing (a table, whose offset is a row-major cellIdx)
 * carries its `foreignDragHitTest` so the drag can resolve a cell-coordinate
 * point. Shared by cross-block drag and intra-table cell drag.
 */

import type { AnyBlockKind } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { readBlockPath } from './path-lookup';

export interface BlockHit {
	path: number[];
	/** Editable surface for character-offset hit-testing (or the wrapper when none). */
	element: HTMLElement;
	/**
	 * Set for block kinds with internal coordinate addressing (e.g. table, whose
	 * offset is a row-major cellIdx, not a character index). Pre-bound to the
	 * block's wrapper; resolved from the kind descriptor so the caller carries no
	 * block-specific DOM knowledge.
	 */
	foreignDragHitTest?: (clientX: number, clientY: number) => number | null;
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
			const kind = el.getAttribute('data-block-kind');
			// tryGet tolerates junk DOM strings — unregistered kinds resolve undefined.
			const hitTest = kind
				? tryGetBlockKindDescriptor(kind as AnyBlockKind)?.foreignDragHitTest
				: undefined;
			if (hitTest) {
				const wrapper = el;
				return {
					path,
					element: wrapper,
					foreignDragHitTest: (cx, cy) => hitTest(wrapper, cx, cy)
				};
			}
			const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
			return { path, element: editable ?? el };
		}
		el = el.parentElement;
	}
	return null;
}
