/**
 * Places the caret from a viewport point: a click in the editor's dead space (the padding
 * beside a block, the area below the last one) and the public `placeCaretAtPoint`, which share
 * one walk. A point between two blocks may become a gap caret; otherwise it clamps into the
 * nearest mounted block and resolves there. Only mounted blocks are measured, so "below the
 * last block" is checked against the CST rather than the DOM (VR-6).
 */

import { CURSOR_END, type BlockComponent } from '../block-component';
import { blockAtPoint, type BlockHit } from './block-hit-test';
import type { CaretTarget } from '../schema/block-kind-descriptor';
import { measureBlocks, nearestBand, probePointIn, type MeasuredBlock } from './nearest-block';
import { placeGapCaret } from './caret-doors';
import { canGapStop, type GapStopScope } from './gap-caret';
import { offsetFromViewportPoint } from '../cursor/point-offset';
import type { SelectionEndpoint } from './primitives';

// ── Public API ─────────────────────────────────────────────────────────────

export interface DeadSpaceCaretDeps {
	getBlockComponent(path: number[]): BlockComponent | null;
	/**
	 * The pointerdown reset from `cross-block/pointer.ts`, bound to a plain click: a dead-space
	 * click must end a live cross-block range exactly as a click on a block does.
	 */
	resetSelectionForClick(): void;
	/** What a gap caret needs; a point between two root-level blocks lands there. */
	gapScope: GapStopScope;
	/** The document's own last top-level index, from the CST. The last mounted band is the
	 *  document's last block only while nothing is windowed out below it. */
	lastBlockIndex(): number;
	/** Mounts a top-level block and hands back its component, through the same path undo's
	 *  restore uses. */
	revealBlock(index: number): Promise<BlockComponent | null>;
}

export interface DeadSpaceCaret {
	/** `root` is the element the installing effect captured, not a live binding. */
	notePress(root: HTMLElement, event: MouseEvent): void;
	/** Returns whether the click was handled; false leaves the click to its usual handlers. */
	handleClick(root: HTMLElement, event: MouseEvent): boolean;
	/**
	 * The placement itself, with no click checks in front of it, for the public
	 * `placeCaretAtPoint`. Shared so the two can never resolve one point differently. True means
	 * the point was handled; a point below a tail that is not mounted yet is handled after the
	 * mount.
	 */
	placeAtPoint(root: HTMLElement, x: number, y: number): boolean;
	/** Whether a click target is the editor's dead space (the root, or a block list inside it). */
	isDeadSpaceTarget(root: HTMLElement, target: EventTarget | null): boolean;
	/**
	 * The endpoint a drag that starts in dead space (or on a block's rendered face) anchors at:
	 * where a click there would land, without landing. A block with text anchors at that offset;
	 * a rendered leaf such as an equation anchors as a whole block, so the range takes all of it
	 * whichever way the drag goes. A grid kind such as a table anchors nothing.
	 */
	anchorAtPoint(root: HTMLElement, x: number, y: number): SelectionEndpoint | null;
	/** The path of the block nearest a click, the point clamped into its box: what a click on
	 *  the margin or on a block's own box selects in. */
	blockPathNearPoint(root: HTMLElement, x: number, y: number): number[] | null;
}

export function createDeadSpaceCaret(deps: DeadSpaceCaretDeps): DeadSpaceCaret {
	// Tracked from pointerdown because `click` alone cannot tell a dead-space click from a drag
	// that started on a block and released in the margin: both report dead space as the target.
	let pressedOnDeadSpace = false;

	/** A click below the document when its tail is not mounted: mount the real last block, then
	 *  land at its end, which is where the clamped point below lands once the tail is mounted. */
	async function landAtDocumentEnd(): Promise<void> {
		const index = deps.lastBlockIndex();
		if (index < 0) return;
		const component = await deps.revealBlock(index);
		if (!component?.focusable) return;
		deps.resetSelectionForClick();
		component.focus(CURSOR_END);
	}

	function placeAtPoint(root: HTMLElement, x: number, y: number): boolean {
		// One measuring pass: the gap check and the nearest-block clamp read the same layout, and
		// a second query would force layout again inside one click.
		const blocks = measureBlocks(root);
		const boundary = rootBoundaryOutsideBands(blocks, y);
		if (boundary !== null && canGapStop(deps.gapScope, [], boundary)) {
			// The reset first, as for a block below: it clears the gap caret, so nothing may run
			// between it and `placeGapCaret`, which also ends a live range (G2.12).
			deps.resetSelectionForClick();
			placeGapCaret(deps.gapScope.selection, { parentPath: [], index: boundary });
			return true;
		}
		const band = nearestBand(
			blocks.map((b) => b.rect),
			y
		);
		if (!band) return false;

		// Below the last mounted block is not below the document while a tail is windowed out,
		// and the host's own below-the-editor handler resolves against the whole document, so
		// the two would land a document apart. The last block has no box to probe until it mounts.
		if (band.belowAll && lastMountedTopLevel(blocks) !== deps.lastBlockIndex()) {
			void landAtDocumentEnd();
			return true;
		}

		const { x: probeX, y: probeY } = probePointIn(blocks[band.index].rect, x, y, band.belowAll);

		const hit = blockAtPoint(root, probeX, probeY);
		if (!hit) return false;
		// A text block puts the caret on the line the click is level with, as any editor does. A
		// block with no text (an equation, a table, a rule), or one showing its source only while
		// it is being edited, has no such line: a click that was not on the block is a click on
		// nothing and focuses nothing, so whatever was being edited blurs.
		const transient = hit.charSurface?.classList.contains('md-source-surface') ?? false;
		if ((!hit.charSurface || transient) && !pressedOnBlockContent(root, x, y)) return false;
		const landing = landingFor(hit, probeX, probeY);
		if (!landing) return false;

		const component = deps.getBlockComponent(hit.path);
		if (!component?.focusable) return false;
		// A landing inside a grid needs `focusByPath`; declining a block that lacks it keeps the
		// selection intact.
		if (landing.path.length > 0 && !component.focusByPath) return false;

		// Only once the landing is known, so a declined point leaves the selection as it was: a
		// live range stays painted, and the next printable key replaces the whole of it.
		deps.resetSelectionForClick();
		// Both calls end a live range (`selection/caret-doors.ts`); `focusByPath` reaches the
		// leaf's own `focus`.
		if (landing.path.length === 0) component.focus(landing.offset);
		else component.focusByPath!(landing.path, landing.offset);
		// The probe point is inside the block's box, so the block answers it as it would a click
		// there: a caret at the edge of a non-editable widget shows nothing until the block's
		// own snap paints it.
		leafOf(component, landing.path)?.snapCaretToPoint?.(probeX, probeY);
		return true;
	}

	/** The nearest block's hit for a click, with the probe point clamped into its box. */
	function hitNearPoint(
		root: HTMLElement,
		x: number,
		y: number
	): { hit: BlockHit; probeX: number; probeY: number } | null {
		const blocks = measureBlocks(root);
		const band = nearestBand(
			blocks.map((b) => b.rect),
			y
		);
		if (!band) return null;
		if (band.belowAll && lastMountedTopLevel(blocks) !== deps.lastBlockIndex()) return null;
		const { x: probeX, y: probeY } = probePointIn(blocks[band.index].rect, x, y, band.belowAll);
		const hit = blockAtPoint(root, probeX, probeY);
		return hit && { hit, probeX, probeY };
	}

	function anchorAtPoint(root: HTMLElement, x: number, y: number): SelectionEndpoint | null {
		const near = hitNearPoint(root, x, y);
		if (!near) return null;
		const { hit, probeX, probeY } = near;
		// No text to measure against (a rendered equation, a rule, a table), so the whole block is
		// the unit and its side is picked later by the drag's direction. An offset would put a
		// range end at the block's start and leave the block out; a cell would turn the drag into
		// a caret placement in the nearest column.
		if (!hit.charSurface) return { path: hit.path.slice(), wholeBlock: true };
		const landing = landingFor(hit, probeX, probeY);
		if (!landing) return null;
		if (landing.path.length > 0) return { path: hit.path.slice(), wholeBlock: true };
		return { path: hit.path.slice(), offset: landing.offset };
	}

	function blockPathNearPoint(root: HTMLElement, x: number, y: number): number[] | null {
		return hitNearPoint(root, x, y)?.hit.path.slice() ?? null;
	}

	return {
		isDeadSpaceTarget: isDeadSpace,
		anchorAtPoint,
		blockPathNearPoint,
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
			// A drag that ended in the margin leaves a real range behind, and collapsing it would
			// throw away what the user just selected. Only native ranges count here: a cross-block
			// range is painted by the overlay with the native selection empty, and is ended below.
			const native = root.ownerDocument.defaultView?.getSelection();
			if (native && native.rangeCount > 0 && !native.isCollapsed) return false;

			return placeAtPoint(root, event.clientX, event.clientY);
		},

		placeAtPoint
	};
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The last mounted top-level index; -1 when none is mounted. */
function lastMountedTopLevel(blocks: MeasuredBlock[]): number {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const path = blocks[i].path;
		if (path?.length === 1) return path[0];
	}
	return -1;
}

/**
 * The root-level gap a `y` outside every block's box names: the editor's top padding, or the
 * space between two adjacent blocks. Below the last block is excluded: that click means "end
 * of document", and the last mounted block is not the last block while a tail is windowed
 * out. Indices are read off the path attribute for the same reason.
 */
function rootBoundaryOutsideBands(blocks: MeasuredBlock[], y: number): number | null {
	const bands = blocks.flatMap((b) =>
		b.path?.length === 1 ? [{ index: b.path[0], top: b.rect.top, bottom: b.rect.bottom }] : []
	);
	if (bands.length === 0) return null;
	// Only when the document's first block is mounted: above a windowed-out head, the blocks
	// under the point are not the ones the gap would name.
	if (y < bands[0].top) return bands[0].index === 0 ? 0 : null;
	for (let i = 1; i < bands.length; i++) {
		const above = bands[i - 1];
		const below = bands[i];
		if (above.index + 1 === below.index && y > above.bottom && y < below.top) return below.index;
	}
	return null;
}

/** The component the landing addresses: this one for a text block, else the cell a grid
 *  kind's inner path names. */
function leafOf(component: BlockComponent, path: number[]): BlockComponent | null {
	if (path.length === 0) return component;
	return component.getBlockComponentByPath?.(path) ?? null;
}

/**
 * The targets that count as dead space: the root, and any block list inside it. A host that
 * pads `.block-list` moves the visible side gutter onto the list, which then reports itself as
 * the target rather than the root.
 */
function isDeadSpace(root: HTMLElement, target: EventTarget | null): boolean {
	if (target === root) return true;
	return target instanceof Element && target.classList.contains('block-list');
}

/** Whether the original point (not the clamped probe) sits inside some block's content: on a
 *  descendant of a block host, not on the host's own box or the dead space around it. */
function pressedOnBlockContent(root: HTMLElement, x: number, y: number): boolean {
	const direct = document.elementFromPoint(x, y);
	if (!(direct instanceof Element) || isDeadSpace(root, direct)) return false;
	const host = direct.closest('[data-block-path]');
	return host !== null && host !== direct;
}

/**
 * Where the caret goes for a hit: an inner child path (empty for a text block) plus the offset
 * within that leaf. Null declines the click.
 */
function landingFor(hit: BlockHit, probeX: number, probeY: number): CaretTarget | null {
	if (hit.caretTargetAtPoint) return hit.caretTargetAtPoint(probeX, probeY);
	// A kind with only the drag hook addresses cells and named no caret landing.
	if (hit.foreignDragHitTest) return null;
	// A leaf with no text (a rule, a rendered equation) reaches here only when clicked on its
	// own box: the block itself is the landing, and its `focus` ignores the offset.
	if (!hit.charSurface) return { path: [], offset: 0 };
	// Reading mode turns contenteditable off, and a non-editable leaf has no character position.
	if (!hit.charSurface.matches('[contenteditable="true"]')) return null;
	const offset = offsetFromViewportPoint(hit.charSurface, probeX, probeY);
	return offset === null ? null : { path: [], offset };
}
