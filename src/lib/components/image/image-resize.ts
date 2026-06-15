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
	// A not-yet-loaded image reports naturalWidth 0 — there's no ratio to apply,
	// so leave the height unset (the `|N` form) instead of committing `|Nx0`.
	if (naturalWidth === 0) return undefined;
	return Math.round((newWidth / naturalWidth) * naturalHeight);
}
