import type { Page } from '@playwright/test';

// Reads of the cross-block selection paint as one region, for the specs that check its shape.

export interface Band {
	top: number;
	bottom: number;
}

/** The vertical extent of every painted selection rect, in viewport pixels. */
export async function paintedBands(page: Page): Promise<Band[]> {
	return page.locator('.selection-overlay').evaluateAll((els) =>
		els
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0.5 && r.height > 0.5)
			.map((r) => ({ top: r.top, bottom: r.bottom }))
	);
}

/** The stretches between the first painted rect and the last that nothing paints. */
export function holes(bands: Band[]): string[] {
	const sorted = [...bands].sort((a, b) => a.top - b.top);
	const found: string[] = [];
	let bottom = sorted[0].bottom;
	for (const band of sorted.slice(1)) {
		if (band.top > bottom + 0.5) found.push(`${bottom.toFixed(1)} to ${band.top.toFixed(1)}`);
		bottom = Math.max(bottom, band.bottom);
	}
	return found;
}
