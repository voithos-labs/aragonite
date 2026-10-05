/**
 * Pure queries over a prose block's inline content and raw source: which live widget a caret
 * offset touches, which one a selected widget names, the leading/trailing edge widgets, and
 * whether an offset has only whitespace to one side.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { DocumentView, NodeView } from '../../../core/node-views';
import { isBlankText } from '../../../core/lines';
import { isInlineWidget, flattenInlineWidgets } from '../../../core/inline/inline-widgets';
import { resolvedInlineContent, type InlineReading } from '../../../core/inline/inline-cache';
import { blockNodeAt } from '../../../tree-operations/node-primitives';
import type { GrammarView } from '../../../schema/block-openers';
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

/** The live widget the caret sits against, or null. At a boundary two widgets share,
 *  `direction` breaks the tie: forward takes the second widget, backward the first. */
export function widgetAtCursor(
	offset: number | null,
	inlineContent: ReadonlyArray<InlineNode> | undefined,
	raw: string,
	direction: CaretDirection = 'backward',
	grammar: GrammarView
): WidgetAtCursor | null {
	if (offset === null) return null;
	let leadingMatch: WidgetAtCursor | null = null;
	let trailingMatch: WidgetAtCursor | null = null;
	// Recurse so a widget nested inside a link (`[![alt][ref]][repo]`) is seen.
	for (const inline of flattenInlineWidgets(inlineContent ?? [], raw, grammar)) {
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
	const inlines = resolvedInlineContent(node, reading);
	const widgets = flattenInlineWidgets(inlines, node.raw, reading.grammar);
	return widgets.find((widget) => widget.start === sourceStart) ?? null;
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

/** First widget reachable from the leading edge, skipping blank text; null once any
 *  non-blank, non-widget inline intervenes. */
export function findFirstEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string,
	grammar: GrammarView
): InlineNode | null {
	for (const inline of inlines) {
		if (isInlineWidget(inline, raw, grammar)) return inline;
		if (inline.kind === 'text' && isBlankText(inline.text ?? '')) continue;
		return null;
	}
	return null;
}

/** Trailing-edge counterpart of `findFirstEdgeWidget`. */
export function findLastEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string,
	grammar: GrammarView
): InlineNode | null {
	for (let i = inlines.length - 1; i >= 0; i--) {
		const inline = inlines[i];
		if (isInlineWidget(inline, raw, grammar)) return inline;
		if (inline.kind === 'text' && isBlankText(inline.text ?? '')) continue;
		return null;
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
