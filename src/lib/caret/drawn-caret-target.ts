/**
 * What the drawn caret shows for one paint's reads: nothing, the browser's own caret, or a bar at
 * a box relative to the block host it draws in. Pure over what the paint read, so the whole table
 * of reasons is a unit table.
 */

/** A caret box in client pixels: its x, and the top and bottom of its line. */
export interface ClientCaretBox {
	left: number;
	top: number;
	bottom: number;
}

/** The block host's padding-box origin in client pixels, and how much an ancestor scales it. */
export interface HostBox {
	left: number;
	top: number;
	scale: number;
}

/** What one paint read off the page. */
export interface DrawnCaretReads {
	/** This editor draws its caret: the `caret` prop and, for `auto`, a fine pointer. */
	draws: boolean;
	reading: boolean;
	windowFocused: boolean;
	/** Focus is inside the editor's content. */
	focused: boolean;
	/** What the selection store holds instead of a caret. */
	store: { crossBlock: boolean; wholeBlock: boolean; gapCaret: boolean; widget: boolean };
	/** The native selection is a caret, or there is none. */
	collapsed: boolean;
	/** The registered surface holding the caret, or null for any other editable. */
	source: { drawable: boolean } | null;
	/** The caret sits beside an inline widget, where the snap caret draws. */
	besideWidget: boolean;
	/** The caret sits where a line wraps, which the range reads as the first line's end whichever
	 *  line the browser draws its caret on. */
	atSoftWrap: boolean;
	caret: ClientCaretBox | null;
	host: HostBox | null;
	devicePixelRatio: number;
}

/** The bar's box in the host's own pixels. */
export interface DrawnCaretRect {
	x: number;
	y: number;
	height: number;
}

export type DrawnCaretTarget =
	{ state: 'hidden' } | { state: 'native' } | { state: 'text'; rect: DrawnCaretRect };

export function drawnCaretTarget(reads: DrawnCaretReads): DrawnCaretTarget {
	if (!reads.draws) return { state: 'native' };
	if (hides(reads)) return { state: 'hidden' };
	const { source, caret, host } = reads;
	if (!source || !source.drawable || reads.besideWidget || reads.atSoftWrap || !caret || !host) {
		return { state: 'native' };
	}
	// Snapped in client pixels, where the device grid is, so a 1px bar never smears over two.
	const dpr = reads.devicePixelRatio;
	const left = Math.round(caret.left * dpr) / dpr;
	return {
		state: 'text',
		rect: {
			x: (left - host.left) / host.scale,
			y: (caret.top - host.top) / host.scale,
			height: (caret.bottom - caret.top) / host.scale
		}
	};
}

function hides(reads: DrawnCaretReads): boolean {
	const { store } = reads;
	return (
		reads.reading ||
		!reads.windowFocused ||
		!reads.focused ||
		!reads.collapsed ||
		store.crossBlock ||
		store.wholeBlock ||
		store.gapCaret ||
		store.widget
	);
}
