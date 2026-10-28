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
	/** The bar beside the widget edge a click or the caret writer holds, or null. */
	widgetEdge: WidgetEdgeBox | null;
	/** A held press whose click will move the caret from where the press put it. */
	pressed: boolean;
	/** The caret sits beside an inline widget, where the range has no box of its own. */
	besideWidget: boolean;
	/** The caret sits where a line wraps, which the range reads as the first line's end whichever
	 *  line the browser draws its caret on. */
	atSoftWrap: boolean;
	/** A scroller inside the block clips the caret's box, and the browser's caret with it. */
	clipped: boolean;
	/** The caret sits at a code chip's edge, where the browser paints off the range's box. */
	atCodeChipEdge: boolean;
	/** The bar at the chip stop the next letter types at, drawn against the chip's own box; null
	 *  off a chip's edge, or where no look says which side. */
	chip: ClientCaretBox | null;
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
	| { state: 'chip'; rect: DrawnCaretRect }
	| { state: 'widget'; rect: DrawnCaretRect & { width: number } }
	| { state: 'pressed' }
	/** `y` is the bar's top in the host's pixels; its ends follow the gap's element. */
	| { state: 'gap'; y: number };

export function drawnCaretTarget(reads: DrawnCaretReads): DrawnCaretTarget {
	// Forced colors show the browser's caret whatever `caret-color` says, so a bar would be a second.
	if (reads.forcedColors) return { state: 'native' };
	if (!drawsHere(reads)) return { state: 'native' };
	if (hides(reads)) return { state: 'hidden' };
	const { source, caret, host, widgetEdge, devicePixelRatio: dpr } = reads;
	if (reads.gap) return { state: 'gap', y: host ? gapTop(host, dpr) : GAP_RISE };
	if (!source || !source.drawable) return { state: 'native' };
	// Nothing draws until the click lands, so no frame shows a caret where it won't stay.
	if (reads.pressed) return { state: 'pressed' };
	if (!host) return { state: 'native' };
	if (widgetEdge) {
		const rect = inHost(widgetEdge.left, widgetEdge, host);
		return { state: 'widget', rect: { ...rect, width: widgetEdge.width / host.scale } };
	}
	if (reads.chip) return { state: 'chip', rect: onDeviceGrid(reads.chip, host, dpr) };
	if (!caret || offTheRange(reads)) return { state: 'native' };
	return { state: 'text', rect: onDeviceGrid(caret, host, dpr) };
}

/** Whether the paint hides the browser's caret on the editable: wherever a bar would draw, and
 *  during a press the click will move the caret away from. */
export function hidesBrowserCaret(target: DrawnCaretTarget): boolean {
	return target.state !== 'hidden' && target.state !== 'native';
}

// In client pixels, where the device grid is: the bar stands in the column the letter boundary falls
// in, as the browser's caret does, and covers every row the line touches.
function onDeviceGrid(box: ClientCaretBox, host: HostBox, dpr: number): DrawnCaretRect {
	const top = deviceFloor(box.top, dpr);
	const bottom = Math.ceil(box.bottom * dpr - GRID_SLACK) / dpr;
	return inHost(deviceFloor(box.left, dpr), { left: 0, top, bottom }, host);
}

// The gap bar's top sits a pixel above the boundary, on the device row that pixel starts in.
function gapTop(host: HostBox, dpr: number): number {
	return (deviceFloor(host.top + GAP_RISE, dpr) - host.top) / host.scale;
}

function deviceFloor(x: number, dpr: number): number {
	return Math.floor(x * dpr + GRID_SLACK) / dpr;
}

/** Absorbs float error on an edge that is already on the grid, so it isn't pushed a row away. */
const GRID_SLACK = 1e-3;

const GAP_RISE = -1;

function inHost(left: number, box: ClientCaretBox, host: HostBox): DrawnCaretRect {
	return {
		x: (left - host.left) / host.scale,
		y: (box.top - host.top) / host.scale,
		height: (box.bottom - box.top) / host.scale
	};
}

// The browser draws no caret at a gap, a widget edge or a chip's outside stop, and none should show
// during a press the click moves, so the editor decides there whatever the caret prop says.
function drawsHere(reads: DrawnCaretReads): boolean {
	return (
		reads.draws || reads.gap || reads.widgetEdge !== null || reads.chip !== null || reads.pressed
	);
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
