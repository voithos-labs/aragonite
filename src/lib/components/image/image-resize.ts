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

/**
 * The height a release persists — the one the drag showed. An aspect-locked drag lets the height
 * follow the width, so it persists `|N` and leaves the derivation to the renderer; an unlocked
 * drag holds the height the image already had, which only the explicit `|NxM` form can carry.
 */
export function resolveDraggedHeight(
	aspectLocked: boolean,
	previewHeight: number
): number | undefined {
	// A widget that never laid out reports 0; `|Nx0` is worse than no hint at all.
	if (aspectLocked || previewHeight < 1) return undefined;
	return Math.round(previewHeight);
}
