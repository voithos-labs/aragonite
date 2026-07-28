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
			w.classList.toggle(SELECTED_CLASS, range.intersectsNode(w));
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
