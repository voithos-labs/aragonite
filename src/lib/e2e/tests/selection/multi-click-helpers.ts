import type { Page } from '@playwright/test';
import { BLOCK_CONTENT_SELECTOR } from '../../editor-page';
import { pointInGap, textRunRect, widgetCenter, type Point } from '../../text-runs';

/** The center of a top-level block's box: the aim point for a block that renders no text. */
export function blockCenter(page: Page, index: number): Promise<{ x: number; y: number }> {
	return page.evaluate((i) => {
		const el = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement | null;
		if (!el) throw new Error(`no block [${i}]`);
		const box = el.getBoundingClientRect();
		return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	}, index);
}

export function nativeSelectionText(page: Page): Promise<string> {
	return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/** The editor's own range: its cross-block endpoints, or the single-block range it reports. */
export function editorSelection(page: Page): Promise<unknown> {
	return page.evaluate(() => (window as any).__test.getSelection());
}

/** Clicks `clicks` times at `from` and drags the last one to `to`. */
export async function multiClickDrag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	clicks: number
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	for (let i = 1; i < clicks; i++) {
		await page.mouse.down({ clickCount: i });
		await page.mouse.up({ clickCount: i });
	}
	await page.mouse.down({ clickCount: clicks });
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up({ clickCount: clicks });
}

/** A point a little past the end of the first painted run of `needle`, still inside the block's
 *  box: where a click lands on no glyph when the run ends its line. */
export async function pastLineEnd(page: Page, needle: string): Promise<Point> {
	const run = await textRunRect(page, needle);
	return { x: run.right + 40, y: run.top + run.height / 2 };
}

/** The middle of the gutter between a container's own box and the editable holding `needle`. */
export async function gutterLeftOf(page: Page, needle: string): Promise<Point> {
	const run = await textRunRect(page, needle);
	if (!run.path || run.path.length < 2) throw new Error(`no container holds ${needle}`);
	const host = (path: number[]) => page.locator(`[data-block-path='${JSON.stringify(path)}']`);
	const editable = host(run.path).locator(BLOCK_CONTENT_SELECTOR).first();
	return pointInGap(host(run.path.slice(0, -1)), editable, 'left', run.top + run.height / 2);
}

/** The center of the `- ` marker the container draws inside the editable holding `needle`: a
 *  widget inside the editable element, not part of its text. */
export async function markerCenterOf(page: Page, needle: string): Promise<Point> {
	const run = await textRunRect(page, needle);
	const at = await page.evaluate((path) => {
		const block = document.querySelector(`[data-block-path='${JSON.stringify(path)}']`);
		const marker = block?.querySelector('.md-marker[contenteditable="false"]');
		const b = marker?.getBoundingClientRect();
		return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
	}, run.path);
	if (!at) throw new Error(`no marker beside ${JSON.stringify(needle)}`);
	return at;
}

/** The centre of the nth rendered inline widget, or of the `aim` element inside it. */
export function inlineWidgetCenter(page: Page, aim?: string, index = 0): Promise<Point> {
	return widgetCenter(page.locator('[data-inline-widget]').nth(index), aim);
}

/** Clicks `clicks` times at one point, each its own down and up: the run a real double- or
 *  triple-click makes, which `clickCount` alone does not. */
export async function multiClick(
	page: Page,
	at: { x: number; y: number },
	clicks: number
): Promise<void> {
	await page.mouse.move(at.x, at.y);
	for (let i = 1; i <= clicks; i++) {
		await page.mouse.down({ clickCount: i });
		await page.mouse.up({ clickCount: i });
	}
}
