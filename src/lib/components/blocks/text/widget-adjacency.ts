/**
 * Pure adjacency queries over a prose block's inline content and raw source:
 * which live widget (image / br) a caret offset touches, the leading/trailing
 * edge widgets, and whether an offset has only whitespace to one side. The
 * component owns selection/DOM; these own the offset math.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import { isInlineWidget, flattenInlineWidgets } from '../../../core/inline/inline-widgets';

export interface WidgetRange {
	start: number;
	end: number;
}

export interface WidgetAtCursor extends WidgetRange {
	atRight: boolean;
	// The widget kind drives the caret-entry policy (reveal-capable vs select) at
	// the call site; carried here so the handler needn't re-walk the inline content.
	kind: AnyInlineKind;
}

/** The live widget the caret sits against, or null. `atRight` distinguishes a
 *  caret at the widget's trailing edge from one at its leading edge. */
export function widgetAtCursor(
	offset: number | null,
	inlineContent: ReadonlyArray<InlineNode> | undefined,
	raw: string
): WidgetAtCursor | null {
	if (offset === null) return null;
	// Recurse so a widget nested inside a link (`[![alt][ref]][repo]`) is seen.
	for (const inline of flattenInlineWidgets(inlineContent ?? [], raw)) {
		if (offset === inline.start)
			return { start: inline.start, end: inline.end, atRight: false, kind: inline.kind };
		if (offset === inline.end)
			return { start: inline.start, end: inline.end, atRight: true, kind: inline.kind };
	}
	return null;
}

export function findWidgetNodeByStart(
	sourceStart: number,
	inlineContent: ReadonlyArray<InlineNode> | undefined,
	raw: string
): WidgetRange | null {
	for (const inline of flattenInlineWidgets(inlineContent ?? [], raw)) {
		if (inline.start === sourceStart) {
			return { start: inline.start, end: inline.end };
		}
	}
	return null;
}

/** First widget reachable from the leading edge, skipping blank text. Returns
 *  the inline node (its `kind` drives the caret-entry policy) or null once any
 *  non-blank, non-widget inline intervenes. */
export function findFirstEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string
): InlineNode | null {
	for (const inline of inlines) {
		if (isInlineWidget(inline, raw)) return inline;
		if (inline.kind === 'text' && (inline.text ?? '').trim() === '') continue;
		return null;
	}
	return null;
}

/** Trailing-edge counterpart of `findFirstEdgeWidget`. */
export function findLastEdgeWidget(
	inlines: ReadonlyArray<InlineNode>,
	raw: string
): InlineNode | null {
	for (let i = inlines.length - 1; i >= 0; i--) {
		const inline = inlines[i];
		if (isInlineWidget(inline, raw)) return inline;
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
