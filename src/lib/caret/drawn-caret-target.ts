/**
 * What the drawn caret shows for one paint's reads: nothing, the browser's own caret, or a bar
 * relative to the element it draws in, at a text caret, beside an inline widget or across a gap
 * between blocks. Pure over what the paint read, so the whole table of reasons is a unit table.
 */

/** A caret box in client pixels: its x, and the top and bottom of its line. */
export interface ClientCaretBox {
	left: number;
	top: number;
	bottom: number;
}

/** The bar beside an inline widget, in client pixels: its left side, top, bottom and width. */
export interface WidgetEdgeBox extends ClientCaretBox {
	width: number;
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
	/** Forced colors show the browser's caret whatever `caret-color` says. */
	forcedColors: boolean;
	reading: boolean;
	windowFocused: boolean;
	/** Focus is inside the editor's content. */
	focused: boolean;
	/** What the selection store holds instead of a caret. */
	store: { crossBlock: boolean; wholeBlock: boolean; gapCaret: boolean; widget: boolean };
	/** The native selection is a caret, or there is none. */
	collapsed: boolean;
	/** The registered editable holding the caret, or null for any other editable. */
	source: { drawable: boolean } | null;
	/** Focus is in the gap caret's proxy, the editable that takes input between two blocks. */
	gap: boolean;
	/** The widget edge a click meant, as the bar's box; a null box while a pointer-down beside a
	 *  widget waits for its click. Null when neither. */
	widgetEdge: { box: WidgetEdgeBox | null } | null;
	/** The caret sits beside an inline widget, where the range has no box of its own. */
	besideWidget: boolean;
	/** The caret sits where a line wraps, which the range reads as the first line's end whichever
	 *  line the browser draws its caret on. */
	atSoftWrap: boolean;
	/** A scroller inside the block clips the caret's box, and the browser's caret with it. */
	clipped: boolean;
	/** The caret sits at a code chip's edge, where the browser paints off the range's box. */
	atCodeChipEdge: boolean;
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
	| { state: 'hidden' }
	| { state: 'native' }
	| { state: 'text'; rect: DrawnCaretRect }
	| { state: 'widget'; rect: (DrawnCaretRect & { width: number }) | null }
	| { state: 'gap' };

export function drawnCaretTarget(reads: DrawnCaretReads): DrawnCaretTarget {
	// Forced colors show the browser's caret whatever `caret-color` says, so a bar would be a second.
	if (reads.forcedColors) return { state: 'native' };
	if (!drawsHere(reads)) return { state: 'native' };
	if (hides(reads)) return { state: 'hidden' };
	if (reads.gap) return { state: 'gap' };
	const { source, caret, host, widgetEdge } = reads;
	if (!source || !source.drawable || !host) return { state: 'native' };
	if (widgetEdge) {
		const { box } = widgetEdge;
		return {
			state: 'widget',
			rect: box && { ...inHost(box.left, box, host), width: box.width / host.scale }
		};
	}
	if (!caret || offTheRange(reads)) return { state: 'native' };
	// Snapped in client pixels, where the device grid is, so a 1px bar never smears over two.
	const dpr = reads.devicePixelRatio;
	return { state: 'text', rect: inHost(Math.round(caret.left * dpr) / dpr, caret, host) };
}

/** Whether the paint hides the browser's caret on the editable: wherever a bar would draw, and
 *  for a pointer-down beside a widget, where the browser's caret would flash taller. */
export function hidesBrowserCaret(target: DrawnCaretTarget): boolean {
	return target.state === 'text' || target.state === 'widget' || target.state === 'gap';
}

function inHost(left: number, box: ClientCaretBox, host: HostBox): DrawnCaretRect {
	return {
		x: (left - host.left) / host.scale,
		y: (box.top - host.top) / host.scale,
		height: (box.bottom - box.top) / host.scale
	};
}

// The browser draws no caret at a gap or a widget edge, so the editor draws there whatever the
// caret prop or the pointer says.
function drawsHere(reads: DrawnCaretReads): boolean {
	return reads.draws || reads.gap || reads.widgetEdge !== null;
}

// Where the range's box isn't where the browser's own caret is, the browser's caret is the truth.
function offTheRange(reads: DrawnCaretReads): boolean {
	return reads.besideWidget || reads.atSoftWrap || reads.clipped || reads.atCodeChipEdge;
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
		store.gapCaret !== reads.gap ||
		store.widget
	);
}
