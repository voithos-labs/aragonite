/**
 * The mounted block nearest a viewport point, and the endpoint that point addresses. A gesture
 * that must answer every point (a dead-space click, a drag into the margin) resolves an off-block
 * point here: clamped into the nearest box, then handed down a container to the child level with
 * it. Only mounted blocks are measured; a caller handling an unmounted tail does so itself.
 */

import { clampPointIntoBox } from '../cursor/point-offset';
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

/**
 * The band a `y` belongs to. `belowAll` marks a point past the last band, the end-of-document
 * gesture, which lands at a trailing corner rather than under its own x. A y in a gap resolves to
 * the nearest band, so no point is left unanswered. Bands arrive in document order and may nest,
 * so containment scans forward, outermost wins.
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

// ── Probing ────────────────────────────────────────────────────────────────

/** The band's own probe point: {@link clampPointIntoBox}, except that `belowAll` takes the
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
	/** Lazy so a drag whose point falls back on its own anchor block never pays the hit-test. */
	endpointHere(): SelectionEndpoint | null;
}

/** The block a point addresses: the one under it, else the nearest one with the point clamped
 *  into its box. Null only where nothing is mounted. */
export function blockNearPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): NearestBlock | null {
	const direct = blockAtPoint(editorRoot, clientX, clientY);
	if (direct)
		return addressedAt(descendToLevelChild(editorRoot, { hit: direct, x: clientX, y: clientY }));

	const rects = blockHosts(editorRoot).map((el) => el.getBoundingClientRect());
	const band = nearestBand(rects, clientY);
	if (!band) return null;
	const probe = probePointIn(rects[band.index], clientX, clientY, band.belowAll);
	const hit = blockAtPoint(editorRoot, probe.x, probe.y);
	return hit && addressedAt(descendToLevelChild(editorRoot, { hit, ...probe }, band.belowAll));
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

function addressedAt({ hit, x, y }: ProbedHit): NearestBlock {
	return { path: hit.path, endpointHere: () => endpointAtPoint(hit, x, y) };
}

/** The one selector for the mounted hosts, so the lookups above can't drift apart. */
function blockHosts(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[data-block-path]')];
}
