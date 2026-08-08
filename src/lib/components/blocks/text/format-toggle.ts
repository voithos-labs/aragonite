/**
 * Toggle bold/italic formatting inside a prose block. Over a SELECTION, strips flanking
 * markers only when they belong to a same-format construct enclosing it, else wraps —
 * so emphasis over `word` in `**word**` nests to `***word***` rather than eating a star.
 * At a COLLAPSED CARET, unwraps the enclosing span, else removes the empty pair the
 * previous press left, else inserts a pair and lands the caret between its halves — a strategy
 * live mode forks away from before reaching here, since an abandoned pair it paints nothing for
 * is invisible garbage (pending marks, § 4.3).
 */

import { parseInline } from '../../../core/inline';
import type { InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';

/** The delimiter run that opens and closes a construct of this kind. */
export function markersFor(format: InlineMarkKind): string {
	return format === 'strong' ? '**' : '*';
}

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

// Exactly one span covering the whole slice, so the strip branch can't orphan markers
// on a multi-span selection like `**a** **b**`.
function isSingleSpanOf(slice: string, format: InlineMarkKind): boolean {
	const nodes = parseInline(slice, 0, slice.length);
	return (
		nodes.length === 1 &&
		nodes[0].kind === format &&
		nodes[0].start === 0 &&
		nodes[0].end === slice.length
	);
}

// Needs the FULL-context parse: `*word*` carved from `**word**` and from `***word***`
// read identically in isolation, but only the latter sits inside an emphasis span, so
// only there do the flanking markers belong to the construct being stripped.
function formatSpanEncloses(
	display: string,
	start: number,
	end: number,
	format: InlineMarkKind,
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

// Innermost, so `***x***` toggled to strong drops the strong layer and leaves emphasis
// standing. Null at a span's outer edge, where the caret is not yet in the construct.
function innermostFormatSpanAt(
	display: string,
	caret: number,
	format: InlineMarkKind,
	mLen: number
): { start: number; end: number } | null {
	let found: { start: number; end: number } | null = null;
	const visit = (nodes: InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind === format && node.start + mLen <= caret && caret <= node.end - mLen) {
				found = { start: node.start, end: node.end };
			}
			if (node.children) visit(node.children);
		}
	};
	visit(parseInline(display, 0, display.length));
	return found;
}

function toggleAtCaret(
	display: string,
	caret: number,
	format: InlineMarkKind,
	markers: string,
	mLen: number
): ToggleInlineFormatResult {
	const enclosing = innermostFormatSpanAt(display, caret, format, mLen);
	if (enclosing) {
		return {
			newDisplay:
				display.slice(0, enclosing.start) +
				display.slice(enclosing.start + mLen, enclosing.end - mLen) +
				display.slice(enclosing.end),
			newSelStart: caret - mLen,
			newSelEnd: caret - mLen
		};
	}

	// The empty pair the previous press inserted; there is no span to find, since `****`
	// parses as literal text.
	if (
		display.slice(caret - mLen, caret) === markers &&
		display.slice(caret, caret + mLen) === markers
	) {
		return {
			newDisplay: display.slice(0, caret - mLen) + display.slice(caret + mLen),
			newSelStart: caret - mLen,
			newSelEnd: caret - mLen
		};
	}

	return {
		newDisplay: display.slice(0, caret) + markers + markers + display.slice(caret),
		newSelStart: caret + mLen,
		newSelEnd: caret + mLen
	};
}

export function toggleInlineFormat(
	display: string,
	selection: { start: number; end: number },
	format: InlineMarkKind
): ToggleInlineFormatResult {
	const markers = markersFor(format);
	const mLen = markers.length;
	const { start, end } = selection;
	if (start === end) return toggleAtCaret(display, start, format, markers, mLen);
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

	// Selection flanked by markers outside the range (e.g. `word` inside `*word*`). The
	// construct check is what makes `**word**` toggled to emphasis nest rather than strip.
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
