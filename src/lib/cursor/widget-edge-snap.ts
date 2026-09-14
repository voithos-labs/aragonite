/**
 * Which atomic island's raw edge a click beside one lands on. Geometry only — the caller measures
 * the islands — so a run of flush islands is one nearest-edge comparison rather than a scan that
 * stops at the first island the point is past, which answers the first of N every time.
 */

export interface WidgetEdgeCandidate {
	/** The island's own raw source span; the caret seats at one end or the other. */
	start: number;
	end: number;
	rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
}

/**
 * The raw offset a point beside the islands snaps to, in document order for ties. Null where the
 * point snaps to none: inside an island, whose own click handling owns it, or with no island to
 * either side. A null `y` is a point with no line to compare against, so vertical distance drops
 * out and horizontal containment alone reads as inside.
 */
export function nearestWidgetEdgeOffset(
	candidates: Iterable<WidgetEdgeCandidate>,
	x: number,
	y: number | null
): number | null {
	let best: Reach | null = null;
	for (const { start, end, rect } of candidates) {
		const withinRow = y === null || (rect.top < y && y < rect.bottom);
		if (rect.left < x && x < rect.right && withinRow) return null;
		// Rows before columns: a point past the end of one line must not reach an island on
		// another line that happens to sit at the same x.
		const rowGap = y === null ? 0 : Math.max(rect.top - y, y - rect.bottom, 0);
		if (x <= rect.left) best = nearer(best, { offset: start, rowGap, gap: rect.left - x });
		if (x >= rect.right) best = nearer(best, { offset: end, rowGap, gap: x - rect.right });
	}
	return best?.offset ?? null;
}

interface Reach {
	offset: number;
	rowGap: number;
	gap: number;
}

function nearer(held: Reach | null, next: Reach): Reach {
	if (!held) return next;
	if (next.rowGap !== held.rowGap) return next.rowGap < held.rowGap ? next : held;
	return next.gap < held.gap ? next : held;
}
