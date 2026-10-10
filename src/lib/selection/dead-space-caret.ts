/**
 * Places the caret from a viewport point, for a click in the editor's dead space (the padding
 * beside a block, the area below the last one) and the public `placeCaretAtPoint` alike. A point
 * between two blocks may become a gap caret; otherwise it clamps into the nearest mounted block
 * and descends to the child level with it. Only mounted blocks are measured.
 */

import { CURSOR_END, type BlockComponent } from '../block-component';
import { blockAtPoint, holdsOwnText, type BlockHit } from './block-hit-test';
import type { CaretTarget } from '../schema/block-kind-descriptor';
import {
	descendToLevelChild,
	measureBlocks,
	nearestBand,
	probePointIn,
	type MeasuredBlock,
	type ProbedHit
} from './nearest-block';
import { placeGapCaret } from './place-caret';
import { canGapStop, type GapStopScope } from './gap-caret';
import { caretOffsetAtPoint } from '../caret/point-offset';
import type { CaretPosition, SelectionEndpoint } from './primitives';
import type { LandingOutcome } from './caret-landing';
import { docPathFrom } from '../caret/coordinate-spaces';

// ── Public API ─────────────────────────────────────────────────────────────

export interface DeadSpaceCaretDeps {
	getBlockComponent(path: number[]): BlockComponent | null;
	/** The pointerdown reset for a plain click: a dead-space click must end a live cross-block
	 *  range exactly as a click on a block does. */
	resetSelectionForClick(): void;
	/** What a gap caret needs; a point between two root-level blocks lands there. */
	gapScope: GapStopScope;
	/** The document's own last top-level index, from the CST. The last mounted band is the
	 *  document's last block only while nothing is windowed out below it. */
	lastBlockIndex(): number;
	/** The caret landing's `land`: mounts the block and puts the caret there as an arrival. */
	land(pos: CaretPosition): Promise<LandingOutcome>;
}

export interface DeadSpaceCaret {
	/** `root` is the element the installing effect captured, not a live binding. */
	notePress(root: HTMLElement, event: MouseEvent): void;
	/** Returns whether the click was handled; false leaves the click to its usual handlers. */
	handleClick(root: HTMLElement, event: MouseEvent): boolean;
	/** The placement without the click checks, shared with the public `placeCaretAtPoint` so the
	 *  two never resolve a point differently; a point below an unmounted tail lands on mount. */
	placeAtPoint(root: HTMLElement, x: number, y: number): boolean;
	/** Whether a click target is the editor's dead space (the root, or a block list inside it). */
	isDeadSpaceTarget(root: HTMLElement, target: EventTarget | null): boolean;
	/** Where a click at the point would land, as a drag anchor: a text offset, or the whole block
	 *  (a table, an equation) so the range takes all of it whichever way the drag goes. */
	anchorAtPoint(root: HTMLElement, x: number, y: number): SelectionEndpoint | null;
	/** The path of the block nearest a click, the point clamped into its box: what a click on
	 *  the margin or on a block's own box selects in. */
	blockPathNearPoint(root: HTMLElement, x: number, y: number): number[] | null;
}

export function createDeadSpaceCaret(deps: DeadSpaceCaretDeps): DeadSpaceCaret {
	// Tracked from pointerdown because `click` alone cannot tell a dead-space click from a drag
	// that started on a block and released in the margin: both report dead space as the target.
	let pressedOnDeadSpace = false;

	/** A click below the document when its tail is not mounted: land at the real last block's end,
	 *  which is where the clamped point below lands once the tail is mounted. */
	async function landAtDocumentEnd(): Promise<void> {
		const index = deps.lastBlockIndex();
		if (index < 0) return;
		// Before the landing; a click below every line is past the last one's end, a fresh start.
		deps.resetSelectionForClick();
		await deps.land({ path: docPathFrom([index]), offset: CURSOR_END, fresh: true });
	}

	function placeAtPoint(root: HTMLElement, x: number, y: number): boolean {
		// One measuring pass: the gap check and the nearest-block clamp read the same layout, and
		// a second query would force layout again inside one click.
		const blocks = measureBlocks(root);
		const boundary = rootBoundaryOutsideBands(blocks, y);
		if (boundary !== null && canGapStop(deps.gapScope, [], boundary)) {
			// The reset runs first, as for a block below: it clears the gap caret, so nothing may
			// run between it and `placeGapCaret`, which also ends a live range (G2.12).
			deps.resetSelectionForClick();
			placeGapCaret(deps.gapScope.selection, deps.gapScope.caretWriter, {
				parentPath: [],
				index: boundary
			});
			return true;
		}
		const band = nearestBand(
			blocks.map((b) => b.rect),
			y
		);
		if (!band) return false;

		// Below the last mounted block is not below the document while a tail is windowed out,
		// and the real last block has no box to hit-test until it mounts.
		if (band.belowAll && lastMountedTopLevel(blocks) !== deps.lastBlockIndex()) {
			void landAtDocumentEnd();
			return true;
		}

		const near = hitInBand(root, blocks, band, x, y);
		if (!near) return false;
		const { hit, x: probeX, y: probeY } = near;
		// A block with no text line (an equation, a table, source shown only while editing) takes
		// only a click on its content; a click beside it focuses nothing, so the edit blurs.
		const transient = hit.charSurface?.classList.contains('md-source-surface') ?? false;
		if ((!hit.charSurface || transient) && !pressedOnBlockContent(root, x, y)) return false;
		const landing = landingFor(hit, probeX, probeY);
		if (!landing) return false;

		const component = deps.getBlockComponent(hit.path);
		if (!component?.focusable) return false;
		// A caret target inside a grid needs `focusByPath`; declining a block that lacks it keeps
		// the selection intact.
		if (landing.path.length > 0 && !component.focusByPath) return false;

		// The reset waits for a known caret target, so a declined point leaves a live range painted
		// and the next printable key replaces the whole of it.
		deps.resetSelectionForClick();
		// Both calls end a live range (`selection/place-caret.ts`); `focusByPath` reaches the
		// leaf's own `focus`.
		if (landing.path.length === 0) component.focus(landing.offset);
		else component.focusByPath!(landing.path, landing.offset);
		// The block's own snap answers the clamped point as a click there, so a caret beside a
		// non-editable widget is painted rather than showing nothing.
		const leaf =
			landing.path.length === 0
				? component
				: deps.getBlockComponent([...hit.path, ...landing.path]);
		leaf?.snapCaretToPoint?.(probeX, probeY);
		return true;
	}

	/** The nearest block's hit for a click, with the point clamped into its box. */
	function hitNearPoint(root: HTMLElement, x: number, y: number): ProbedHit | null {
		const blocks = measureBlocks(root);
		const band = nearestBand(
			blocks.map((b) => b.rect),
			y
		);
		if (!band) return null;
		if (band.belowAll && lastMountedTopLevel(blocks) !== deps.lastBlockIndex()) return null;
		return hitInBand(root, blocks, band, x, y);
	}

	function anchorAtPoint(root: HTMLElement, x: number, y: number): SelectionEndpoint | null {
		const near = hitNearPoint(root, x, y);
		if (!near) return null;
		const { hit, x: probeX, y: probeY } = near;
		// No text to measure against: an offset would put a range end at the block's start and
		// leave the block out, and a cell would turn the drag into a caret placement.
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
			// A drag that ended in the margin leaves a native range the user just selected. A
			// cross-block range leaves the native selection empty, so it is ended below instead.
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

/** The root-level gap a `y` outside every block's box names. Below the last block is excluded:
 *  that click means end of document, and the last mounted block may not be the last block. */
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

/** The block a band answers for a point: the point clamped into the band's box, then handed
 *  down to the child level with it when the box is a container's. */
function hitInBand(
	root: HTMLElement,
	blocks: MeasuredBlock[],
	band: { index: number; belowAll: boolean },
	x: number,
	y: number
): ProbedHit | null {
	const probe = probePointIn(blocks[band.index].rect, x, y, band.belowAll);
	const hit = blockAtPoint(root, probe.x, probe.y);
	return hit && descendToLevelChild(root, { hit, ...probe }, band.belowAll);
}

/** The root and any block list inside it: a host that pads `.block-list` moves the side gutter
 *  onto the list, which then reports itself as the click target. */
function isDeadSpace(root: HTMLElement, target: EventTarget | null): boolean {
	if (target === root) return true;
	return target instanceof Element && target.classList.contains('block-list');
}

/** Whether the original point (not the clamped one) sits inside some block's content: on a
 *  descendant of a block host, not on the host's own box or the dead space around it. */
function pressedOnBlockContent(root: HTMLElement, x: number, y: number): boolean {
	const direct = document.elementFromPoint(x, y);
	if (!(direct instanceof Element) || isDeadSpace(root, direct)) return false;
	const host = direct.closest('[data-block-path]');
	return host !== null && host !== direct;
}

/** Where the caret goes for a hit: an inner child path (empty for a text block) and the offset
 *  within that leaf; null declines the click. */
function landingFor(hit: BlockHit, probeX: number, probeY: number): CaretTarget | null {
	if (hit.caretTargetAtPoint) return hit.caretTargetAtPoint(probeX, probeY);
	// A kind with only the drag hook addresses cells and names no caret target.
	if (hit.foreignDragHitTest) return null;
	// A leaf with no text (a rule, a rendered equation) reaches here only when clicked on its
	// own box: the block itself is the target, and its `focus` ignores the offset.
	if (!hit.charSurface) return { path: [], offset: 0 };
	// Reading mode turns editing off, so no text is a block's own there. A container that kept
	// the point has only its children's text, none of it level with the point.
	if (!holdsOwnText(hit)) return null;
	// A block whose box pads its own text (a code block) lands a point in that padding on the
	// nearest line.
	const offset = caretOffsetAtPoint(hit.charSurface, probeX, probeY);
	return offset === null ? null : { path: [], offset };
}
