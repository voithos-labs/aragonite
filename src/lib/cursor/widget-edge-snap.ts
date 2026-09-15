/**
 * Which atomic inline widget's raw edge a point lands on: the nearest edge among the widgets the
 * caller measures, so a run of adjacent widgets answers the one the point is actually beside. A
 * point inside a widget reads its kind: one that behaves like a character names the edge on the
 * point's side, while one that selects whole declines and keeps its own click handling.
 */

export interface WidgetEdgeCandidate {
	/** The widget's own raw source span; the caret goes at one end or the other. */
	start: number;
	end: number;
	rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
	/** The kind behaves as one character, so a click on it names an edge by side rather than
	 *  selecting the widget whole. */
	seatsInside: boolean;
}

export interface WidgetEdgeSeat {
	offset: number;
	/** The click landed on the widget itself. The browser would put the caret in the text
	 *  beside it, and that caret is no reason to drop this snap. */
	inside: boolean;
}

/**
 * The raw offset a point snaps to, in document order for ties. Null where the point snaps to none:
 * inside a widget that selects whole, whose own click handling owns it, or with no widget to
 * either side. A null `y` is a point with no line to compare against, so vertical distance drops
 * out and horizontal containment alone reads as inside.
 */
export function nearestWidgetEdgeSeat(
	candidates: Iterable<WidgetEdgeCandidate>,
	x: number,
	y: number | null
): WidgetEdgeSeat | null {
	let best: Reach | null = null;
	for (const { start, end, rect, seatsInside } of candidates) {
		const withinRow = y === null || (rect.top < y && y < rect.bottom);
		if (rect.left < x && x < rect.right && withinRow) {
			if (!seatsInside) return null;
			return { offset: x < (rect.left + rect.right) / 2 ? start : end, inside: true };
		}
		// Compare rows before columns: a point past the end of one line must not reach a widget
		// on another line that happens to sit at the same x.
		const rowGap = y === null ? 0 : Math.max(rect.top - y, y - rect.bottom, 0);
		if (x <= rect.left) best = nearer(best, { offset: start, rowGap, gap: rect.left - x });
		if (x >= rect.right) best = nearer(best, { offset: end, rowGap, gap: x - rect.right });
	}
	return best === null ? null : { offset: best.offset, inside: false };
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
