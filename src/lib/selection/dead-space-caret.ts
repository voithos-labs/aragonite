/**
 * Caret placement for a click in the editor's dead space — the root's own padding
 * beside a block, or the empty area below the last one. Both used to land focus on
 * the root and place no caret at all, so the click did nothing a user could see.
 *
 * The rule is one sentence: clamp the point into the nearest block's box and let the
 * existing hit test resolve the leaf under it. Nothing here knows a block kind — the
 * clamp turns "beside a line" into a point ON that line and "below everything" into
 * the last block's trailing corner, and `blockAtPoint` descends into containers by
 * itself. Surfaces that address something other than characters (a table, whose
 * offset is a cell index) decline rather than guess; see `docs/issues.md`.
 *
 * "Below the last block" means below the last MOUNTED one: the bands come from the
 * live DOM, which under virtual rendering is the window, not the document. Harmless
 * as the gesture stands — the dead space below the document is only visible when you
 * are scrolled to the bottom, where the last block is mounted — but anything built on
 * these bands must not assume the whole document is in them.
 */

import type { BlockComponent } from '../block-component';
import { blockAtPoint } from './block-hit-test';
import { offsetFromViewportPoint } from './native-bridge';

// ── Public API ─────────────────────────────────────────────────────────────

export interface BlockBand {
	top: number;
	bottom: number;
}

/**
 * The band a dead-space `y` belongs to. `belowAll` marks a click past the last
 * band — the end-of-document gesture, which lands at a trailing corner rather than
 * under the click's own x. A y in a gap between bands (or above the first) resolves
 * to the nearest band, so no dead-space click is left unanswered.
 *
 * Bands arrive in document order and may nest (a container's band contains its
 * children's), so containment scans forward and the outermost match wins; the hit
 * test then descends to the leaf.
 */
export function nearestBand(
	bands: BlockBand[],
	y: number
): { index: number; belowAll: boolean } | null {
	if (bands.length === 0) return null;
	const last = bands.length - 1;
	if (y > bands[last].bottom) return { index: last, belowAll: true };

	for (let i = 0; i < bands.length; i++) {
		if (y >= bands[i].top && y <= bands[i].bottom) return { index: i, belowAll: false };
	}

	let nearest = 0;
	let smallestGap = Infinity;
	for (let i = 0; i < bands.length; i++) {
		const gap = y < bands[i].top ? bands[i].top - y : y - bands[i].bottom;
		if (gap < smallestGap) {
			smallestGap = gap;
			nearest = i;
		}
	}
	return { index: nearest, belowAll: false };
}

export interface DeadSpaceCaretDeps {
	getBlockComponent(path: number[]): BlockComponent | null;
	/**
	 * The shared pointerdown preamble (`cross-block/pointer.ts`), pre-bound to a
	 * non-shift press. A dead-space click is a caret-placing gesture and must end a
	 * live cross-block range exactly as a click on a block does.
	 */
	resetSelectionForClick(): void;
}

export interface DeadSpaceCaret {
	/** `root` is the element the installing effect captured, not a live binding. */
	notePress(root: HTMLElement, event: MouseEvent): void;
	/** Returns whether the click was claimed; false leaves every existing click semantic alone. */
	handleClick(root: HTMLElement, event: MouseEvent): boolean;
}

export function createDeadSpaceCaret(deps: DeadSpaceCaretDeps): DeadSpaceCaret {
	// The press half of the gesture, because `click` alone cannot tell a dead-space
	// click from a drag that STARTED on a block and released in the margin — both
	// report the root as their target, since the click event fires on the common
	// ancestor of press and release.
	let pressedOnRoot = false;

	return {
		notePress(root, event) {
			// The root is the only target that means "dead space": every overlay, handle,
			// badge and header-slot node is a descendant with its own target identity,
			// and a press on a block reports the block.
			pressedOnRoot =
				event.target === root &&
				event.button === 0 &&
				// Shift belongs to selection extension, the modifiers to platform commands.
				!(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey);
		},

		handleClick(root, event) {
			const pressed = pressedOnRoot;
			pressedOnRoot = false;
			if (!pressed || event.target !== root) return false;
			// A drag that ended in the margin leaves a real range behind; collapsing it
			// to a caret would throw away what the user just selected. This sees only
			// NATIVE ranges — a cross-block range is overlay-painted with the native
			// selection empty, and that one is ended below rather than declined, which
			// is what a click means.
			const native = root.ownerDocument.defaultView?.getSelection();
			if (native && native.rangeCount > 0 && !native.isCollapsed) return false;

			const rects = [...root.querySelectorAll<HTMLElement>('[data-block-path]')].map((el) =>
				el.getBoundingClientRect()
			);
			const band = nearestBand(rects, event.clientY);
			if (!band) return false;

			const rect = rects[band.index];
			const probeX = band.belowAll
				? rect.right - 1
				: clamp(event.clientX, rect.left + 1, rect.right - 1);
			const probeY = clamp(event.clientY, rect.top + 1, rect.bottom - 1);

			const hit = blockAtPoint(root, probeX, probeY);
			if (!hit || hit.foreignDragHitTest) return false;
			// Reading mode flips contenteditable off, and a non-editable leaf (a rule, a
			// rendered diagram) has no character position to land on — both decline here.
			if (!hit.element.matches('[contenteditable="true"]')) return false;

			const offset = offsetFromViewportPoint(hit.element, probeX, probeY);
			if (offset === null) return false;

			const component = deps.getBlockComponent(hit.path);
			if (!component?.focusable) return false;

			// Only once the landing is known: a declined click leaves the selection as it
			// found it. Left live, the range would still be painted over a caret placed
			// elsewhere, and the next printable key would type-replace the whole of it.
			deps.resetSelectionForClick();
			component.focus(offset);
			return true;
		}
	};
}

// ── Internal ───────────────────────────────────────────────────────────────

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
