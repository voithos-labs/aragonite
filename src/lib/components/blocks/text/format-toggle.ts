/**
 * Toggle bold/italic formatting over a selection inside a prose block.
 * Strips flanking markers only when they belong to a same-format construct
 * enclosing the selection (inside or outside the range); otherwise wraps —
 * so toggling emphasis over `word` in `**word**` nests to `***word***`
 * instead of eating a star of the strong pair.
 */

import { parseInline } from '../../../core/inline';
import type { InlineNode } from '../../../core/nodes';

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

// True only when the slice is exactly one emphasis/strong span of `format`
// covering its whole length — so the strip branch can't orphan markers on a
// multi-span selection like `**a** **b**`.
function isSingleSpanOf(slice: string, format: 'strong' | 'emphasis'): boolean {
	const nodes = parseInline(slice, 0, slice.length);
	return (
		nodes.length === 1 &&
		nodes[0].kind === format &&
		nodes[0].start === 0 &&
		nodes[0].end === slice.length
	);
}

// True when some `format` span in the full-context parse encloses [start, end) as
// content — the flanking markers are that construct's layer, so stripping removes
// the format instead of orphaning an inner marker of a different construct. An
// isolated flank slice can't decide this: `*word*` carved from `**word**` and from
// `***word***` reads identically, but only the latter sits inside an emphasis span.
function formatSpanEncloses(
	display: string,
	start: number,
	end: number,
	format: 'strong' | 'emphasis',
	mLen: number
): boolean {
	const covers = (nodes: InlineNode[]): boolean =>
		nodes.some(
			(node) =>
				(node.kind === format && node.start + mLen <= start && node.end - mLen >= end) ||
				(node.children ? covers(node.children) : false)
		);
	return covers(parseInline(display, 0, display.length));
}

export function toggleInlineFormat(
	display: string,
	selection: { start: number; end: number },
	format: 'strong' | 'emphasis'
): ToggleInlineFormatResult {
	const markers = format === 'strong' ? '**' : '*';
	const mLen = markers.length;
	const { start, end } = selection;
	const selectedSlice = display.slice(start, end);

	// Selection itself includes flanking markers (e.g. user selected `**word**`).
	const selfWrapped =
		selectedSlice.startsWith(markers) &&
		selectedSlice.endsWith(markers) &&
		selectedSlice.length > mLen * 2 &&
		isSingleSpanOf(selectedSlice, format);
	if (selfWrapped) {
		const unwrapped = selectedSlice.slice(mLen, -mLen);
		return {
			newDisplay: display.slice(0, start) + unwrapped + display.slice(end),
			newSelStart: start,
			newSelEnd: start + unwrapped.length
		};
	}

	// Selection flanked by markers outside the range (e.g. `word` inside `*word*`).
	// The construct check keeps a same-format flank from being mistaken for one
	// nested in a wider run — `**word**` toggled to emphasis nests, not strips.
	const flankBefore = display.slice(start - mLen, start);
	const flankAfter = display.slice(end, end + mLen);
	if (
		flankBefore === markers &&
		flankAfter === markers &&
		formatSpanEncloses(display, start, end, format, mLen)
	) {
		return {
			newDisplay: display.slice(0, start - mLen) + selectedSlice + display.slice(end + mLen),
			newSelStart: start - mLen,
			newSelEnd: end - mLen
		};
	}

	return {
		newDisplay: display.slice(0, start) + markers + selectedSlice + markers + display.slice(end),
		newSelStart: start,
		newSelEnd: start + selectedSlice.length + mLen * 2
	};
}
