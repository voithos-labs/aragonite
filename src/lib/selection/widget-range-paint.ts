/**
 * Paints `md-widget-selected` on atomic inline widgets the native Selection
 * range overlaps. Native `::selection` skips contenteditable=false content,
 * so a single-block range across an inline widget would leave it un-tinted.
 * Suspended while the cross-block overlay or the widget-selection popover
 * owns the visual.
 */

const WIDGET_SELECTOR = '[data-inline-widget]';
const SELECTED_CLASS = 'md-widget-selected';

export interface WidgetRangePainterOpts {
	editorRoot: HTMLElement;
	getSelectionIsCustomRendered: () => boolean;
	getWidgetIsSelected: () => boolean;
	lifetime: AbortSignal;
}

export function installWidgetRangePainter(opts: WidgetRangePainterOpts): void {
	const { editorRoot, getSelectionIsCustomRendered, getWidgetIsSelected, lifetime } = opts;
	if (lifetime.aborted) return;

	function clearAll(): void {
		const widgets = editorRoot.querySelectorAll<HTMLElement>(WIDGET_SELECTOR);
		for (const w of widgets) w.classList.remove(SELECTED_CLASS);
	}

	function paint(): void {
		if (getSelectionIsCustomRendered() || getWidgetIsSelected()) {
			clearAll();
			return;
		}

		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
			clearAll();
			return;
		}

		const anchor = sel.anchorNode;
		if (!anchor || !editorRoot.contains(anchor)) {
			clearAll();
			return;
		}

		const range = sel.getRangeAt(0);
		const widgets = editorRoot.querySelectorAll<HTMLElement>(WIDGET_SELECTOR);
		for (const w of widgets) {
			const intersects = safeIntersects(range, w);
			w.classList.toggle(SELECTED_CLASS, intersects);
		}
	}

	const handler = () => paint();
	document.addEventListener('selectionchange', handler);
	lifetime.addEventListener(
		'abort',
		() => {
			document.removeEventListener('selectionchange', handler);
			clearAll();
		},
		{ once: true }
	);
}

// jsdom shipped `Range.intersectsNode` only in recent versions; fall back to a
// boundary comparison when missing so unit tests don't crash on older runtimes.
function safeIntersects(range: Range, node: Node): boolean {
	if (typeof range.intersectsNode === 'function') {
		return range.intersectsNode(node);
	}
	const nodeRange = node.ownerDocument!.createRange();
	nodeRange.selectNode(node);
	const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0;
	const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0;
	return startsBeforeEnd && endsAfterStart;
}
