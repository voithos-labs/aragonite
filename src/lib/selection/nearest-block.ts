/**
 * The mounted block nearest a viewport point, and the endpoint that point addresses. A gesture
 * that must answer EVERY point — the dead-space click, a drag into the margin — resolves an
 * off-block point through here instead of declining it. The probe point never leaves the module:
 * a caller hit-testing at its own raw point gets no offset at all on a character surface.
 * Only mounted blocks are measured; a caller answering for a windowed-out tail reconciles itself.
 */

import { blockAtPoint, endpointAtPoint, type BlockHit } from './block-hit-test';
import type { SelectionEndpoint } from './primitives';
import { readBlockPath } from './path-lookup';

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

/** A point inside `rect`, one pixel off its edges so the topmost element there is the block's
 *  own content; `belowAll` takes the trailing corner, the block's last position. */
export function probePointIn(
	rect: DOMRect,
	x: number,
	y: number,
	belowAll: boolean
): { x: number; y: number } {
	return {
		x: belowAll ? rect.right - 1 : clamp(x, rect.left + 1, rect.right - 1),
		y: clamp(y, rect.top + 1, rect.bottom - 1)
	};
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
	if (direct) return addressedAt(direct, clientX, clientY);

	const rects = blockHosts(editorRoot).map((el) => el.getBoundingClientRect());
	const band = nearestBand(rects, clientY);
	if (!band) return null;
	const probe = probePointIn(rects[band.index], clientX, clientY, band.belowAll);
	const hit = blockAtPoint(editorRoot, probe.x, probe.y);
	return hit && addressedAt(hit, probe.x, probe.y);
}

// ── Internal ───────────────────────────────────────────────────────────────

function addressedAt(hit: BlockHit, probeX: number, probeY: number): NearestBlock {
	return { path: hit.path, endpointHere: () => endpointAtPoint(hit, probeX, probeY) };
}

/** The one selector for the mounted hosts, so the two walks above cannot drift apart. */
function blockHosts(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[data-block-path]')];
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
