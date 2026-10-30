/**
 * Paints `md-widget-selected`, the selection wash, on every selected inline widget: the one the
 * editor holds selected whole, or those a browser range overlaps, since `::selection` skips
 * contenteditable=false content. It paints nothing while the cross-block overlay draws the range,
 * or while another view draws the held widget (an image's ring).
 */

import { widgetElAt } from '../caret/block-el-lookup';
import type { WidgetTarget } from './primitives';
import { readNativeSelection } from '../browser/selection-read';

const WIDGET_SELECTOR = '[data-inline-widget]';
const SELECTED_CLASS = 'md-widget-selected';

export interface WidgetSelectionPainterOpts {
	editorRoot: HTMLElement;
	getSelectionIsCustomRendered: () => boolean;
	getHeldWidget: () => WidgetTarget | null;
	/** Another view draws the held widget's selection, so the wash would be a second mark. */
	getHeldWidgetDrawnElsewhere: () => boolean;
	lifetime: AbortSignal;
}

export interface WidgetSelectionPainter {
	/** Repaints from the current selection: the owner calls it when the held widget or the DOM
	 *  under it changes, which fires no `selectionchange`. */
	repaint(): void;
}

export function installWidgetSelectionPainter(
	opts: WidgetSelectionPainterOpts
): WidgetSelectionPainter {
	const { editorRoot, lifetime } = opts;
	let painted: HTMLElement[] = [];

	function selectedWidgets(): HTMLElement[] {
		if (opts.getSelectionIsCustomRendered()) return [];
		const held = opts.getHeldWidget();
		if (held) {
			if (opts.getHeldWidgetDrawnElsewhere()) return [];
			const el = widgetElAt(editorRoot, held.paragraphPath, held.sourceStart);
			return el ? [el] : [];
		}
		const live = readNativeSelection();
		if (!live || live.collapsed || !editorRoot.contains(live.anchor.node)) return [];
		const { range } = live;
		const widgets = editorRoot.querySelectorAll<HTMLElement>(WIDGET_SELECTOR);
		return [...widgets].filter((w) => range.intersectsNode(w));
	}

	function paint(next: HTMLElement[]): void {
		for (const w of painted) if (!next.includes(w)) w.classList.remove(SELECTED_CLASS);
		for (const w of next) w.classList.add(SELECTED_CLASS);
		painted = next;
	}

	const repaint = () => {
		if (!lifetime.aborted) paint(selectedWidgets());
	};
	if (lifetime.aborted) return { repaint };

	document.addEventListener('selectionchange', repaint);
	lifetime.addEventListener(
		'abort',
		() => {
			document.removeEventListener('selectionchange', repaint);
			paint([]);
		},
		{ once: true }
	);
	return { repaint };
}
