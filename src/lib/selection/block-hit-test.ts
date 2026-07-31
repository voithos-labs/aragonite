/**
 * Viewport point to the block under it, for pointer hit-testing: walks ancestors of the topmost
 * element to the nearest `data-block-path` host. A kind with internal coordinate addressing
 * carries the point→internals hooks its descriptor declares, so a caller resolves a
 * cell-coordinate point without knowing the kind.
 */

import type { AnyBlockKind } from '../core/nodes';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { readBlockPath } from './path-lookup';

export interface BlockHit {
	path: number[];
	/**
	 * Editable surface for character-offset hit-testing, or the WRAPPER when the kind declares
	 * `foreignDragHitTest`: that kind addresses cells and has no character surface to offer.
	 */
	element: HTMLElement;
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
			const editable = wrapper.querySelector('[contenteditable]') as HTMLElement | null;
			return {
				path,
				// The wrapper substitution belongs to the DRAG hook alone: its consumers branch on
				// that hook and otherwise character-hit-test `element`, so a wrapper handed to them
				// yields a plausible-but-wrong offset instead of declining. The caret hook says
				// nothing about a drag.
				element: dragHitTest ? wrapper : (editable ?? wrapper),
				foreignDragHitTest: dragHitTest && ((cx, cy) => dragHitTest(wrapper, cx, cy)),
				caretTargetAtPoint: caretTarget && ((cx, cy) => caretTarget(wrapper, cx, cy))
			};
		}
		el = el.parentElement;
	}
	return null;
}
