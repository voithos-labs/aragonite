/**
 * The block a viewport point addresses: the one under it, else the nearest mounted box with the
 * point clamped in, handed down a container to the child level with it. Two lookups on one walk:
 * a drag follows the nearest mounted block as autoscroll mounts more (`blockNearPoint`); a press
 * answers about the document, so below an unmounted tail it names no block (`hitAtDocumentPoint`).
 */

import { clampPointIntoBox } from '../browser/point';
import { blockAtPoint, endpointAtPoint, holdsOwnText, type BlockHit } from './block-hit-test';
import type { SelectionEndpoint } from './primitives';
import { readBlockPath } from './path-lookup';
import { isStrictAncestorOf } from './path-math';

// ── Bands ──────────────────────────────────────────────────────────────────

export interface BlockBand {
	top: number;
	bottom: number;
}

/** One mounted block's path and box. */
export interface MeasuredBlock {
	path: number[] | null;
	rect: DOMRect;
}

/** Document order, since bands may nest and every walk over them depends on it. */
export function measureBlocks(root: HTMLElement): MeasuredBlock[] {
	return blockHosts(root).map((el) => ({
		path: readBlockPath(el),
		rect: el.getBoundingClientRect()
	}));
}

/** The band a `y` belongs to; a y in a gap resolves to the nearest band, so no point is left
 *  unanswered. `belowAll` marks a point past the last band, which lands at a trailing corner. */
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

// ── Probing ────────────────────────────────────────────────────────────────

/** The point a band is hit-tested at: {@link clampPointIntoBox}, except that `belowAll` takes the
 *  trailing corner (the block's last position) rather than the point's own x. */
export function probePointIn(
	rect: DOMRect,
	x: number,
	y: number,
	belowAll: boolean
): { x: number; y: number } {
	const inside = clampPointIntoBox(rect, x, y);
	return { x: belowAll ? rect.right - 1 : inside.x, y: inside.y };
}

export interface NearestBlock {
	path: number[];
	/** The editable holding the block's own text; null for a block with none (a table, a rule)
	 *  and for a container whose text all belongs to its children. */
	ownText: HTMLElement | null;
	/** Lazy so a drag whose point falls back on its own anchor block never pays the hit-test. */
	endpointHere(): SelectionEndpoint | null;
}

/** The block a point addresses among the mounted ones: the one under it, else the nearest one
 *  with the point clamped into its box. Null only where nothing is mounted. */
export function blockNearPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): NearestBlock | null {
	// Inside a box the band walk below names this same block, so the direct read only saves the
	// measuring pass.
	const direct = blockAtPoint(editorRoot, clientX, clientY);
	if (direct)
		return nearestBlockOf(descendToLevelChild(editorRoot, { hit: direct, x: clientX, y: clientY }));

	const rects = blockHosts(editorRoot).map((el) => el.getBoundingClientRect());
	const band = nearestBand(rects, clientY);
	const probed = band && hitInBand(editorRoot, rects[band.index], band.belowAll, clientX, clientY);
	return probed ? nearestBlockOf(probed) : null;
}

/** {@link hitAtDocumentPoint}'s answer for a point below the last mounted block while the
 *  document's last block is windowed out: that block has no box to hit-test until it mounts. */
export const UNMOUNTED_TAIL = 'unmounted-tail';

/** The block a press addresses in the document; `blocks` is the press's one measuring pass and
 *  `lastBlockIndex` the document's own last top-level index. */
export function hitAtDocumentPoint(
	root: HTMLElement,
	blocks: MeasuredBlock[],
	x: number,
	y: number,
	lastBlockIndex: number
): ProbedHit | typeof UNMOUNTED_TAIL | null {
	const band = nearestBand(
		blocks.map((b) => b.rect),
		y
	);
	if (!band) return null;
	if (band.belowAll && lastMountedTopLevel(blocks) !== lastBlockIndex) return UNMOUNTED_TAIL;
	return hitInBand(root, blocks[band.index].rect, band.belowAll, x, y);
}

/** The last mounted top-level index; -1 when none is mounted. */
export function lastMountedTopLevel(blocks: MeasuredBlock[]): number {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const path = blocks[i].path;
		if (path?.length === 1) return path[0];
	}
	return -1;
}

/** A probed hit as the block it names, its endpoint read at the probed point. */
export function nearestBlockOf({ hit, x, y }: ProbedHit): NearestBlock {
	return {
		path: hit.path,
		ownText: holdsOwnText(hit) ? hit.charSurface : null,
		endpointHere: () => endpointAtPoint(hit, x, y)
	};
}

// ── Descent ────────────────────────────────────────────────────────────────

/** A hit and the point it was hit-tested at. */
export interface ProbedHit {
	hit: BlockHit;
	x: number;
	y: number;
}

/** Hands a point on a container's own box (a quote's gutter, a list's indent) down to the child
 *  level with it, at any depth; a container with its own editable row keeps an unmatched point. */
export function descendToLevelChild(
	root: HTMLElement,
	probed: ProbedHit,
	belowAll = false
): ProbedHit {
	let current = probed;
	for (;;) {
		const { hit, x, y } = current;
		// A grid kind resolves points inside itself through its own hooks.
		if (hit.foreignDragHitTest || hit.caretTargetAtPoint) return current;
		const rects = blockHosts(hit.host).map((el) => el.getBoundingClientRect());
		const band = nearestBand(rects, y);
		if (!band) return current;
		if (holdsOwnText(hit) && !rects.some((r) => y >= r.top && y <= r.bottom)) return current;
		const probe = probePointIn(rects[band.index], x, y, belowAll);
		const next = blockAtPoint(root, probe.x, probe.y);
		// Something drawn over the child answered instead, so the container keeps the point.
		if (!next || !isStrictAncestorOf(hit.path, next.path)) return current;
		current = { hit: next, ...probe };
	}
}

// ── Internal ───────────────────────────────────────────────────────────────

/** The block a band answers for a point: the point clamped into the band's box, then handed
 *  down to the child level with it when the box is a container's. */
function hitInBand(
	root: HTMLElement,
	rect: DOMRect,
	belowAll: boolean,
	x: number,
	y: number
): ProbedHit | null {
	const probe = probePointIn(rect, x, y, belowAll);
	const hit = blockAtPoint(root, probe.x, probe.y);
	return hit && descendToLevelChild(root, { hit, ...probe }, belowAll);
}

/** The one selector for the mounted hosts, so the lookups above can't drift apart. */
function blockHosts(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[data-block-path]')];
}
