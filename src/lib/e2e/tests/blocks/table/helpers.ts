import { type Locator, type Page } from '@playwright/test';

// Shared pointer + clipboard helpers for the table block e2e specs. The drag
// gesture IS the real mouse path (down → interpolated moves → up), so it honors
// the simulate-real-user-actions rule; the 10-step interpolation matches
// EditorPage's own dragMouseTo and the majority of the table specs.

type Box = { x: number; y: number; width: number; height: number };

export async function readClipboard(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}

export async function boxesOf(a: Locator, b: Locator): Promise<readonly [Box, Box]> {
	const ab = await a.boundingBox();
	const bb = await b.boundingBox();
	if (!ab || !bb) throw new Error('boxesOf: missing bounding box');
	return [ab, bb] as const;
}

// Press at the center of `from`, drag through 10 interpolated steps to the center
// of `to`, release. The synthetic zero-size box a caller builds around a point
// collapses to that point.
export async function dragBetweenBoxes(page: Page, from: Box, to: Box): Promise<void> {
	const sx = from.x + from.width / 2;
	const sy = from.y + from.height / 2;
	const ex = to.x + to.width / 2;
	const ey = to.y + to.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) {
		const t = i / 10;
		await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
	}
	await page.mouse.up();
}

// Drag between the centers of two `[role="cell"]` cells addressed by row-major index.
export async function dragBetweenCells(page: Page, fromIdx: number, toIdx: number): Promise<void> {
	const [from, to] = await boxesOf(
		page.locator('[role="cell"]').nth(fromIdx),
		page.locator('[role="cell"]').nth(toIdx)
	);
	await dragBetweenBoxes(page, from, to);
}
