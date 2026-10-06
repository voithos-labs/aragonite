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

interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Every painted selection rect, and the editor's block column it should fill, in viewport pixels. */
export async function paintedRegion(page: Page): Promise<{ rects: Rect[]; column: Rect }> {
	return page.evaluate(() => {
		const list = document.querySelector('.editor > .block-list');
		if (!list) throw new Error('no block list');
		const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
		const rects = [...document.querySelectorAll('.selection-overlay')]
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0.5 && r.height > 0.5)
			.map(box);
		return { rects, column: box(list.getBoundingClientRect()) };
	});
}

/** The x-ranges nothing paints on the lines strictly between the first painted rect and the last,
 *  each named by the y it was read at. */
export function unpaintedMiddle({ rects, column }: { rects: Rect[]; column: Rect }): string[] {
	const first = rects.reduce((a, b) => (b.top < a.top ? b : a));
	const last = rects.reduce((a, b) => (b.bottom > a.bottom ? b : a));
	const edges = [
		...new Set(
			rects.flatMap((r) => [r.top, r.bottom]).filter((y) => y >= first.bottom && y <= last.top)
		)
	].sort((a, b) => a - b);
	const found: string[] = [];
	for (let i = 0; i + 1 < edges.length; i++) {
		const y = (edges[i] + edges[i + 1]) / 2;
		if (edges[i + 1] - edges[i] < 0.5) continue;
		const spans = rects
			.filter((r) => r.top <= y && r.bottom >= y)
			.map((r) => [Math.max(r.left, column.left), Math.min(r.right, column.right)])
			.sort((a, b) => a[0] - b[0]);
		let x = column.left;
		for (const [from, to] of spans) {
			if (from > x + 0.5) found.push(`y ${y.toFixed(1)}: x ${x.toFixed(1)} to ${from.toFixed(1)}`);
			x = Math.max(x, to);
		}
		if (column.right > x + 0.5)
			found.push(`y ${y.toFixed(1)}: x ${x.toFixed(1)} to ${column.right.toFixed(1)}`);
	}
	return found;
}
