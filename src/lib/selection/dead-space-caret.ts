/**
 * Caret placement for a click in the editor's dead space: the root's or a block list's own
 * padding beside a block, and the area below the last one. The rule is one sentence: clamp the
 * point into the nearest block's box and let `blockAtPoint` resolve the leaf under it, so
 * nothing here knows a block kind. "Below the last block" means the last MOUNTED one, since the
 * bands come from the live DOM, which under virtual rendering is the window rather than the
 * document.
 */

import type { BlockComponent } from '../block-component';
import { blockAtPoint, type BlockHit } from './block-hit-test';
import { offsetFromViewportPoint } from './native-bridge';

// ── Public API ─────────────────────────────────────────────────────────────

export interface BlockBand {
	top: number;
	bottom: number;
}

/**
 * The band a dead-space `y` belongs to. `belowAll` marks a click past the last band, the
 * end-of-document gesture, which lands at a trailing corner rather than under the click's own
 * x. A y in a gap resolves to the nearest band, so no dead-space click is left unanswered.
 * Bands arrive in document order and may nest, so containment scans forward, outermost wins.
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
	 * The shared pointerdown preamble (`cross-block/pointer.ts`), pre-bound to a non-shift press:
	 * a dead-space click must end a live cross-block range exactly as a click on a block does.
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
	// The press half of the gesture, because `click` alone cannot tell a dead-space click from a
	// drag that STARTED on a block and released in the margin: both report dead space as target.
	let pressedOnDeadSpace = false;

	return {
		notePress(root, event) {
			pressedOnDeadSpace =
				isDeadSpace(root, event.target) &&
				event.button === 0 &&
				// Shift belongs to selection extension, the modifiers to platform commands.
				!(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey);
		},

		handleClick(root, event) {
			const pressed = pressedOnDeadSpace;
			pressedOnDeadSpace = false;
			if (!pressed || !isDeadSpace(root, event.target)) return false;
			// A drag that ended in the margin leaves a real range behind; collapsing it would
			// throw away what the user just selected. This sees only NATIVE ranges: a cross-block
			// range is overlay-painted with the native selection empty, and is ended below instead.
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
			if (!hit) return false;
			const landing = landingFor(hit, probeX, probeY);
			if (!landing) return false;

			const component = deps.getBlockComponent(hit.path);
			if (!component?.focusable) return false;
			// An internal landing needs the deep door; a block declaring the hook without it
			// can't be reached, and declining here keeps the selection intact.
			if (landing.path.length > 0 && !component.focusByPath) return false;

			// Only once the landing is known, so a declined click leaves the selection as it
			// found it: a live range stays painted over a caret placed elsewhere, and the next
			// printable key type-replaces the whole of it.
			deps.resetSelectionForClick();
			// Both doors end the live range (`selection/caret-doors.ts`); `focusByPath` reaches
			// the leaf's own `focus`.
			if (landing.path.length === 0) component.focus(landing.offset);
			else component.focusByPath!(landing.path, landing.offset);
			return true;
		}
	};
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * The targets that mean "dead space": the root, and any block list inside it. A host that
 * widens or pads `.block-list` moves the whole visible side gutter onto the list, which
 * reports itself rather than the root. Everything else the editor renders — blocks,
 * overlays, handles, badges, windowing spacers, header-slot content — has its own identity
 * and is declined here.
 */
function isDeadSpace(root: HTMLElement, target: EventTarget | null): boolean {
	if (target === root) return true;
	return target instanceof Element && target.classList.contains('block-list');
}

/**
 * Where the caret goes for a resolved hit: an internal child path (empty for a
 * character-addressed surface) plus the offset within that leaf. Null declines the click.
 */
function landingFor(
	hit: BlockHit,
	probeX: number,
	probeY: number
): { path: number[]; offset: number } | null {
	if (hit.caretTargetAtPoint) return hit.caretTargetAtPoint(probeX, probeY);
	// A kind with only the drag hook addresses cells and named no caret landing.
	if (hit.foreignDragHitTest) return null;
	// Reading mode flips contenteditable off, and a non-editable leaf has no character position.
	if (!hit.element.matches('[contenteditable="true"]')) return null;
	const offset = offsetFromViewportPoint(hit.element, probeX, probeY);
	return offset === null ? null : { path: [], offset };
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
