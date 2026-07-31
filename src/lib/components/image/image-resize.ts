// Pure math for image drag-to-resize: clamp, snap-to-percentage, aspect lock.
// No DOM — the handles component owns pointer events and calls these.

export const MIN_WIDTH = 16;

const SNAP_PERCENTAGES = [25, 50, 75, 100];

export function clampWidth(width: number, maxWidth: number): number {
	const rounded = Math.round(width);
	if (rounded < MIN_WIDTH) return MIN_WIDTH;
	if (rounded > maxWidth) return maxWidth;
	return rounded;
}

// Above MIN_WIDTH so a held Shift+Arrow can't shrink an image to a sub-clickable
// sliver; the ceiling matches the drag path.
export const KEYBOARD_MIN_WIDTH = 32;

export function keyboardResizeWidth(currentWidth: number, delta: number, maxWidth: number): number {
	return clampWidth(Math.max(KEYBOARD_MIN_WIDTH, currentWidth + delta), maxWidth);
}

export function snapWidth(width: number, maxWidth: number, snapThresholdPx: number): number {
	const rounded = Math.round(width);
	for (const pct of SNAP_PERCENTAGES) {
		const target = Math.round((maxWidth * pct) / 100);
		if (Math.abs(rounded - target) <= snapThresholdPx) return target;
	}
	return rounded;
}

export function resolveAspectLockedHeight(
	newWidth: number,
	naturalWidth: number,
	naturalHeight: number
): number | undefined {
	// A not-yet-loaded image reports naturalWidth 0, so leave the height unset (the
	// `|N` form) rather than committing `|Nx0`.
	if (naturalWidth === 0) return undefined;
	return Math.round((newWidth / naturalWidth) * naturalHeight);
}
