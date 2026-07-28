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
}

/**
 * Place the caret for a click that landed on the editor root itself. Returns whether
 * the click was claimed; a false return leaves every existing click semantic alone.
 */
export function placeCaretFromDeadSpaceClick(
	root: HTMLElement,
	event: MouseEvent,
	deps: DeadSpaceCaretDeps
): boolean {
	// The root is the only target that means "dead space": every overlay, handle,
	// badge and header-slot node is a descendant with its own target identity, and a
	// click on a block reports the block.
	if (event.target !== root) return false;
	if (event.button !== 0) return false;
	// Shift belongs to selection extension, the modifiers to platform commands.
	if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
	// A drag that ended in the margin leaves a real range behind; collapsing it to a
	// caret would throw away what the user just selected.
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
	component.focus(offset);
	return true;
}

// ── Internal ───────────────────────────────────────────────────────────────

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
