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
	/**
	 * Editable surface for character-offset hit-testing (or the wrapper when none). A
	 * kind declaring `foreignDragHitTest` gets the WRAPPER instead: it addresses cells,
	 * so it has no character surface to offer and its drag consumers read the hook.
	 * Declaring only `caretTargetAtPoint` does not cost a kind this surface — the hooks
	 * are independent.
	 */
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
			const wrapper = el;
			const kind = wrapper.getAttribute('data-block-kind');
			// tryGet tolerates junk DOM strings — unregistered kinds resolve undefined.
			const descriptor = kind ? tryGetBlockKindDescriptor(kind as AnyBlockKind) : undefined;
			const dragHitTest = descriptor?.foreignDragHitTest;
			const caretTarget = descriptor?.caretTargetAtPoint;
			const editable = wrapper.querySelector('[contenteditable]') as HTMLElement | null;
			return {
				path,
				// The wrapper substitution belongs to the DRAG hook alone. Its consumers
				// branch on that hook's presence and otherwise character-hit-test `element`,
				// which accepts any contained node — so a wrapper handed to them yields a
				// plausible-but-wrong offset measured across the whole subtree, with no
				// cellCoordinate flag, instead of declining. Declaring the caret hook says
				// nothing about a drag, so it must not cost a kind its character surface.
				element: dragHitTest ? wrapper : (editable ?? wrapper),
				foreignDragHitTest: dragHitTest && ((cx, cy) => dragHitTest(wrapper, cx, cy)),
				caretTargetAtPoint: caretTarget && ((cx, cy) => caretTarget(wrapper, cx, cy))
			};
		}
		el = el.parentElement;
	}
	return null;
}
