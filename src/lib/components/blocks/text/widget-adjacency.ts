/**
 * Pure adjacency queries over a prose block's inline content and raw source:
 * which live widget (image / br) a caret offset touches, the leading/trailing
 * edge widgets, and whether an offset has only whitespace to one side. The
 * component owns selection/DOM; these own the offset math.
 */

import type { InlineNode } from '../../../core/nodes';
import { isLiveWidgetInline } from '../../../core/inline/raw-html-widget';

export interface WidgetRange {
	start: number;
	end: number;
}

export interface WidgetAtCursor extends WidgetRange {
	atRight: boolean;
}

/** The live widget the caret sits against, or null. `atRight` distinguishes a
 *  caret at the widget's trailing edge from one at its leading edge. */
export function widgetAtCursor(
	offset: number | null,
	inlineContent: ReadonlyArray<InlineNode> | undefined,
	raw: string
): WidgetAtCursor | null {
	if (offset === null) return null;
	for (const inline of inlineContent ?? []) {
		if (!isLiveWidgetInline(inline, raw)) continue;
		if (offset === inline.start) return { start: inline.start, end: inline.end, atRight: false };
		if (offset === inline.end) return { start: inline.start, end: inline.end, atRight: true };
	}
	return null;
}

export function findWidgetNodeByStart(
	sourceStart: number,
	inlineContent: ReadonlyArray<InlineNode> | undefined,
	raw: string
): WidgetRange | null {
	for (const inline of inlineContent ?? []) {
		if (isLiveWidgetInline(inline, raw) && inline.start === sourceStart) {
			return { start: inline.start, end: inline.end };
		}
	}
	return null;
}

/** First widget reachable from the leading edge, skipping blank text. Returns
 *  null once any non-blank, non-widget inline intervenes. */
export function findFirstEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string
): WidgetRange | null {
	for (const inline of inlines) {
		if (isLiveWidgetInline(inline, raw)) {
			return { start: inline.start, end: inline.end };
		}
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return null;
	}
	return null;
}

/** Trailing-edge counterpart of `findFirstEdgeWidget`. */
export function findLastEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string
): WidgetRange | null {
	for (let i = inlines.length - 1; i >= 0; i--) {
		const inline = inlines[i];
		if (isLiveWidgetInline(inline, raw)) {
			return { start: inline.start, end: inline.end };
		}
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return null;
	}
	return null;
}

export function rawHasNoTextBefore(raw: string, offset: number): boolean {
	return raw.slice(0, offset).trim() === '';
}

export function rawHasNoTextAfter(raw: string, offset: number): boolean {
	return raw.slice(offset).trim() === '';
}
