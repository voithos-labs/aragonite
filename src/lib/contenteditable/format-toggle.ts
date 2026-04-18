/**
 * Pure toggle logic for bold/italic formatting inside prose blocks. Given a
 * display string, a selection range, and a format name, returns the new
 * display string plus the updated selection bounds. No DOM, no editor
 * coupling — the calling block wires display/selection in and the result
 * back out.
 *
 * Flanking-marker detection: when markers surround the selection OUTSIDE
 * the selected range (selection is `word` and display is `**word**`),
 * toggle strips the flanking markers rather than double-wrapping to
 * `****word****`. Matches Obsidian / VS Code / Google Docs expectations.
 */

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
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

	// Case A: selection itself includes flanking markers (user selected
	// `**word**`). Strip them.
	const selfWrapped =
		selectedSlice.startsWith(markers) &&
		selectedSlice.endsWith(markers) &&
		selectedSlice.length > mLen * 2;
	if (selfWrapped) {
		const unwrapped = selectedSlice.slice(mLen, -mLen);
		return {
			newDisplay: display.slice(0, start) + unwrapped + display.slice(end),
			newSelStart: start,
			newSelEnd: start + unwrapped.length
		};
	}

	// Case B: selection is flanked by markers OUTSIDE the range (user
	// selected `word` inside `**word**`). Strip the surrounding markers.
	const flankBefore = display.slice(start - mLen, start);
	const flankAfter = display.slice(end, end + mLen);
	if (flankBefore === markers && flankAfter === markers) {
		return {
			newDisplay: display.slice(0, start - mLen) + selectedSlice + display.slice(end + mLen),
			newSelStart: start - mLen,
			newSelEnd: end - mLen
		};
	}

	// Case C: no flanking markers anywhere. Wrap the selection.
	return {
		newDisplay: display.slice(0, start) + markers + selectedSlice + markers + display.slice(end),
		newSelStart: start,
		newSelEnd: start + selectedSlice.length + mLen * 2
	};
}
