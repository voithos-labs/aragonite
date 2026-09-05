/**
 * Caret placement from a viewport point: the dead-space click (padding beside a block, the area
 * below the last one) and the public `placeCaretAtPoint`, which shares the walk under the gesture
 * guards. A y belonging to no band may name an eligible gap boundary; otherwise the point clamps
 * into the nearest mounted block's box (`nearest-block.ts`) and resolves there, no kind named.
 * Only what is mounted is measured, so "below the last block" resolves against the CST (VR-6).
 */

import { CURSOR_END, type BlockComponent } from '../block-component';
import { blockAtPoint, type BlockHit } from './block-hit-test';
import type { CaretTarget } from '../schema/block-kind-descriptor';
import { measureBlocks, nearestBand, probePointIn, type MeasuredBlock } from './nearest-block';
import { placeGapCaret } from './caret-doors';
import { canGapStop, type GapStopScope } from './gap-caret';
import { offsetFromViewportPoint } from '../cursor/point-offset';

// ── Public API ─────────────────────────────────────────────────────────────

export interface DeadSpaceCaretDeps {
	getBlockComponent(path: number[]): BlockComponent | null;
	/**
	 * The shared pointerdown preamble (`cross-block/pointer.ts`), pre-bound to a non-shift press:
	 * a dead-space click must end a live cross-block range exactly as a click on a block does.
	 */
	resetSelectionForClick(): void;
	/** The gap-caret arrival's reads; a point landing between two root bands parks there. */
	gapScope: GapStopScope;
	/** The document's own last top-level index, from the CST. The last mounted band is the
	 *  document's last block only while nothing is windowed out below it. */
	lastBlockIndex(): number;
	/** Reveal (mount) a top-level block and hand back its component — the same road undo's
	 *  restore uses. */
	revealBlock(index: number): Promise<BlockComponent | null>;
}

export interface DeadSpaceCaret {
	/** `root` is the element the installing effect captured, not a live binding. */
	notePress(root: HTMLElement, event: MouseEvent): void;
	/** Returns whether the click was claimed; false leaves every existing click semantic alone. */
	handleClick(root: HTMLElement, event: MouseEvent): boolean;
	/**
	 * The landing walk with no gesture discrimination in front of it, for a caller that has
	 * already decided to answer the point — the public `placeCaretAtPoint`. Shared rather than
	 * reimplemented, so the two can never resolve one point differently. True means the point
	 * was claimed; a point past a windowed-out tail claims it and lands after the reveal.
	 */
	placeAtPoint(root: HTMLElement, x: number, y: number): boolean;
}

export function createDeadSpaceCaret(deps: DeadSpaceCaretDeps): DeadSpaceCaret {
	// The press half of the gesture, because `click` alone cannot tell a dead-space click from a
	// drag that STARTED on a block and released in the margin: both report dead space as target.
	let pressedOnDeadSpace = false;

	/** The end-of-document gesture when the tail is windowed out: reveal the real last block,
	 *  then land at its end — which is where the trailing-corner probe below lands when the
	 *  slice already reaches it. */
	async function landAtDocumentEnd(): Promise<void> {
		const index = deps.lastBlockIndex();
		if (index < 0) return;
		const component = await deps.revealBlock(index);
		if (!component?.focusable) return;
		deps.resetSelectionForClick();
		component.focus(CURSOR_END);
	}

	function placeAtPoint(root: HTMLElement, x: number, y: number): boolean {
		// One measuring pass for both walks: the boundary question and the band clamp read the
		// same layout, and a second query would force it again inside one click.
		const blocks = measureBlocks(root);
		const boundary = rootBoundaryOutsideBands(blocks, y);
		if (boundary !== null && canGapStop(deps.gapScope, [], boundary)) {
			// The preamble first, as on the block landing below — it clears the gap, so
			// nothing may run between it and the door. The door ends a live range (G2.12).
			deps.resetSelectionForClick();
			placeGapCaret(deps.gapScope.selection, { parentPath: [], index: boundary });
			return true;
		}
		const band = nearestBand(
			blocks.map((b) => b.rect),
			y
		);
		if (!band) return false;

		// Below the last MOUNTED block is not below the document while a tail is windowed out,
		// and a host's own below-the-editor handler resolves against the whole document — so
		// the two would land a document apart. The reveal road is the only answer available
		// here: the target has no box to probe until it mounts.
		if (band.belowAll && lastMountedTopLevel(blocks) !== deps.lastBlockIndex()) {
			void landAtDocumentEnd();
			return true;
		}

		const { x: probeX, y: probeY } = probePointIn(blocks[band.index].rect, x, y, band.belowAll);

		const hit = blockAtPoint(root, probeX, probeY);
		if (!hit) return false;
		const landing = landingFor(hit, probeX, probeY);
		if (!landing) return false;

		const component = deps.getBlockComponent(hit.path);
		if (!component?.focusable) return false;
		// An internal landing needs the deep door; a block declaring the hook without it
		// can't be reached, and declining here keeps the selection intact.
		if (landing.path.length > 0 && !component.focusByPath) return false;

		// Only once the landing is known, so a declined point leaves the selection as it
		// found it: a live range stays painted over a caret placed elsewhere, and the next
		// printable key type-replaces the whole of it.
		deps.resetSelectionForClick();
		// Both doors end the live range (`selection/caret-doors.ts`); `focusByPath` reaches
		// the leaf's own `focus`.
		if (landing.path.length === 0) component.focus(landing.offset);
		else component.focusByPath!(landing.path, landing.offset);
		// The probe point is inside the block's box, so the surface answers it exactly as it
		// answers a click there: a landing at an atomic widget's edge has nothing to show for
		// itself until the surface's own snap paints it.
		leafOf(component, landing.path)?.snapCaretToPoint?.(probeX, probeY);
		return true;
	}

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

			return placeAtPoint(root, event.clientX, event.clientY);
		},

		placeAtPoint
	};
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The last top-level index the slice currently holds; -1 when none is mounted. */
function lastMountedTopLevel(blocks: MeasuredBlock[]): number {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const path = blocks[i].path;
		if (path?.length === 1) return path[0];
	}
	return -1;
}

/**
 * The root-level boundary a `y` belonging to NO band names: the editor's leading padding,
 * and the space between two adjacent bands where a layout leaves one. Below the last band
 * is excluded — that y is the end-of-document gesture, and under windowing the last MOUNTED
 * band is not the last block. Indices come off the path attribute for the same reason.
 */
function rootBoundaryOutsideBands(blocks: MeasuredBlock[], y: number): number | null {
	const bands = blocks.flatMap((b) =>
		b.path?.length === 1 ? [{ index: b.path[0], top: b.rect.top, bottom: b.rect.bottom }] : []
	);
	if (bands.length === 0) return null;
	// Only when the document's own first block is mounted: above a windowed-out slice the
	// blocks the point sits over are not the ones the boundary would name.
	if (y < bands[0].top) return bands[0].index === 0 ? 0 : null;
	for (let i = 1; i < bands.length; i++) {
		const above = bands[i - 1];
		const below = bands[i];
		if (above.index + 1 === below.index && y > above.bottom && y < below.top) return below.index;
	}
	return null;
}

/** The component the landing addresses: this one on a character surface, else the leaf a
 *  coordinate-addressed kind's internal path names. */
function leafOf(component: BlockComponent, path: number[]): BlockComponent | null {
	if (path.length === 0) return component;
	return component.getBlockComponentByPath?.(path) ?? null;
}

/**
 * The targets that mean "dead space": the root, and any block list inside it. A host that
 * widens or pads `.block-list` moves the whole visible side gutter onto the list, which
 * reports itself rather than the root. Everything else the editor renders has its own
 * identity and is declined here.
 */
function isDeadSpace(root: HTMLElement, target: EventTarget | null): boolean {
	if (target === root) return true;
	return target instanceof Element && target.classList.contains('block-list');
}

/**
 * Where the caret goes for a resolved hit: an internal child path (empty for a
 * character-addressed surface) plus the offset within that leaf. Null declines the click.
 */
function landingFor(hit: BlockHit, probeX: number, probeY: number): CaretTarget | null {
	if (hit.caretTargetAtPoint) return hit.caretTargetAtPoint(probeX, probeY);
	// A kind with only the drag hook addresses cells and named no caret landing.
	if (hit.foreignDragHitTest) return null;
	// Reading mode flips contenteditable off, and a non-editable leaf has no character position.
	if (!hit.charSurface?.matches('[contenteditable="true"]')) return null;
	const offset = offsetFromViewportPoint(hit.charSurface, probeX, probeY);
	return offset === null ? null : { path: [], offset };
}
