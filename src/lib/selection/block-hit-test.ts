/**
 * Viewport point → the block under it, for pointer hit-testing. Walks ancestors of
 * the topmost element to the nearest `data-block-path` host; a kind with internal
 * coordinate addressing (a table, whose offset is a row-major cellIdx) carries the
 * point→internals hooks its descriptor declares, so a caller resolves a
 * cell-coordinate point without knowing the kind. Shared by cross-block drag,
 * intra-table cell drag, and the dead-space caret.
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
	/**
	 * The caret landing inside such a kind, as an internal child path plus offset —
	 * the descriptor's `caretTargetAtPoint`, pre-bound like its drag sibling. Answers
	 * the nearest addressable leaf where the drag hook declines; a caret-placing
	 * gesture reads this one.
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
			const kind = el.getAttribute('data-block-kind');
			// tryGet tolerates junk DOM strings — unregistered kinds resolve undefined.
			const descriptor = kind ? tryGetBlockKindDescriptor(kind as AnyBlockKind) : undefined;
			const dragHitTest = descriptor?.foreignDragHitTest;
			const caretTarget = descriptor?.caretTargetAtPoint;
			// Either hook means the kind addresses its own internals, so the wrapper is
			// the element: there is no single editable surface to hand back.
			if (dragHitTest || caretTarget) {
				const wrapper = el;
				return {
					path,
					element: wrapper,
					foreignDragHitTest: dragHitTest && ((cx, cy) => dragHitTest(wrapper, cx, cy)),
					caretTargetAtPoint: caretTarget && ((cx, cy) => caretTarget(wrapper, cx, cy))
				};
			}
			const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
			return { path, element: editable ?? el };
		}
		el = el.parentElement;
	}
	return null;
}
