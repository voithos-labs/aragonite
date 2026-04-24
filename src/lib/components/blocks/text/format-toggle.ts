/**
 * Toggle bold/italic formatting over a selection inside a prose block.
 * Strips flanking markers when selection is already wrapped (either inside
 * or outside the range); otherwise wraps the selection.
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

	// Selection itself includes flanking markers (e.g. user selected `**word**`).
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

	// Selection flanked by markers outside the range (e.g. `word` inside `**word**`).
	const flankBefore = display.slice(start - mLen, start);
	const flankAfter = display.slice(end, end + mLen);
	if (flankBefore === markers && flankAfter === markers) {
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
