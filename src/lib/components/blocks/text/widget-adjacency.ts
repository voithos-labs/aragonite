/** Pure queries over the widgets a prose block renders and the text around them. */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { DocumentView, NodeView } from '../../../core/node-views';
import { isBlankText } from '../../../core/lines';
import { isInlineWidget, flattenInlineWidgets } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent, type InlineReading } from '../../../core/inline/inline-cache';
import { blockNodeAt } from '../../../tree-operations/node-primitives';
import type { Reading } from '../../../schema/reading';
import type { WidgetTarget } from '../../../selection/primitives';

export interface WidgetRange {
	start: number;
	end: number;
}

export interface WidgetAtCursor extends WidgetRange {
	atRight: boolean;
	// The caller picks its caret-entry policy from this; included so it need not scan again.
	kind: AnyInlineKind;
}

export type CaretDirection = 'forward' | 'backward';

/** Every widget `node` renders, nested ones included (a link or emphasis around an image hides it
 *  from the top-level inline list). Every reader of a block's widgets asks here. */
export function widgetsIn(node: NodeView, reading: InlineReading): InlineNode[] {
	return flattenInlineWidgets(resolvedInlineContent(node, reading), node.raw, reading.grammar);
}

/** The widget among `widgets` the caret sits against, or null. At a boundary two widgets share,
 *  `direction` breaks the tie: forward takes the second widget, backward the first. */
export function widgetAtCursor(
	offset: number | null,
	widgets: ReadonlyArray<InlineNode>,
	direction: CaretDirection = 'backward'
): WidgetAtCursor | null {
	if (offset === null) return null;
	let leadingMatch: WidgetAtCursor | null = null;
	let trailingMatch: WidgetAtCursor | null = null;
	for (const inline of widgets) {
		if (offset === inline.start && !leadingMatch)
			leadingMatch = { start: inline.start, end: inline.end, atRight: false, kind: inline.kind };
		if (offset === inline.end && !trailingMatch)
			trailingMatch = { start: inline.start, end: inline.end, atRight: true, kind: inline.kind };
	}
	if (direction === 'forward') return leadingMatch ?? trailingMatch;
	return trailingMatch ?? leadingMatch;
}

/** The widget of any kind starting at `sourceStart` in `node`, nested ones included, as the block
 *  renders it. Every reader of a selected widget resolves it here. */
export function widgetNodeIn(
	node: NodeView,
	sourceStart: number,
	reading: InlineReading
): InlineNode | null {
	return widgetsIn(node, reading).find((widget) => widget.start === sourceStart) ?? null;
}

/** The span of {@link widgetNodeIn}'s widget. */
export function widgetSpanIn(
	node: NodeView,
	sourceStart: number,
	reading: InlineReading
): WidgetRange | null {
	const widget = widgetNodeIn(node, sourceStart, reading);
	return widget && { start: widget.start, end: widget.end };
}

/** The live span of the widget `target` names in `doc`, or null once none starts at its byte. */
export function widgetSpanAt(
	doc: DocumentView,
	target: WidgetTarget,
	reading: InlineReading
): WidgetRange | null {
	const block = blockNodeAt(doc, target.paragraphPath);
	return block && widgetSpanIn(block, target.sourceStart, reading);
}

/** What the edge readers ask: the inline reading, and whether the mode hides markers at the caret. */
export type EdgeReading = InlineReading & Pick<Reading, 'hidesDelimitersAtCaret'>;

/** The widget `node` draws first, past blank text; null once anything else draws ahead of it. */
export function findFirstEdgeWidget(node: NodeView, reading: EdgeReading): InlineNode | null {
	return edgeWidget(resolvedInlineContent(node, reading), node.raw, reading, 'first');
}

/** The widget `node` draws last, past blank text; null once anything else draws after it. */
export function findLastEdgeWidget(node: NodeView, reading: EdgeReading): InlineNode | null {
	return edgeWidget(resolvedInlineContent(node, reading), node.raw, reading, 'last');
}

function edgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string,
	reading: EdgeReading,
	edge: 'first' | 'last'
): InlineNode | null {
	let level: ReadonlyArray<InlineNode> | null = inlines;
	while (level) {
		const fromEdge: ReadonlyArray<InlineNode> = edge === 'first' ? level : [...level].reverse();
		level = null;
		for (const inline of fromEdge) {
			if (isInlineWidget(inline, raw, reading.grammar)) return inline;
			if (inline.kind === 'text' && isBlankText(inline.text ?? '')) continue;
			// A construct whose markers stay hidden draws only its content, a picture a link wraps.
			if (inline.children && reading.hidesDelimitersAtCaret()) level = inline.children;
			break;
		}
	}
	return null;
}

export function rawHasNoTextBefore(raw: string, offset: number): boolean {
	return isBlankText(raw.slice(0, offset));
}

export function rawHasNoTextAfter(raw: string, offset: number): boolean {
	return isBlankText(raw.slice(offset));
}

/** The inline-widget element whose source starts at `start`, or null. The only place this
 *  selector is written: a mistyped copy would fail silently as a null `querySelector`. */
export function widgetElByStart(el: HTMLElement, start: number): HTMLElement | null {
	return el.querySelector<HTMLElement>(`[data-inline-widget][data-source-start="${start}"]`);
}
