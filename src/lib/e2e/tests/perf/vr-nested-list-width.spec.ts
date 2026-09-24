import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// A list nested in quotes estimates its heights at its own width, not the scroll container's,
// and typing rebuilds no height table.
// Requirements: e2e/requirements/perf/vr-nested-list-width.md.

const DEPTH = 4;
const ITEMS = 80;
const QUOTE = '> '.repeat(DEPTH);
const DOC =
	Array.from({ length: ITEMS }, (_, i) => `${QUOTE}- item ${i} ${'word '.repeat(i % 5)}`).join(
		'\n'
	) + '\n';
// One index per quote, then the list itself.
const LIST_PATH = Array.from({ length: DEPTH + 1 }, () => 0);

type Build = { path: string; width: number };

function heightTableBuilds(page: Page): Promise<Build[]> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().heightTableBuilds);
}

function resetPerf(page: Page): Promise<void> {
	return page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
}

test.describe('a nested list estimates at its own width', () => {
	test('the last height table built for the list used its element width', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await resetPerf(page);
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();

		const listWidth = await page.evaluate(
			(path) =>
				(
					document.querySelector(
						`[data-block-path='${JSON.stringify(path)}'] .list-block`
					) as HTMLElement
				).clientWidth,
			LIST_PATH
		);
		const portWidth = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).clientWidth
		);
		// The fixture is only a check where the two widths differ.
		expect(listWidth).toBeLessThan(portWidth);

		const builds = (await heightTableBuilds(page)).filter((b) => b.path === LIST_PATH.join(','));
		// The first table comes before the element exists, so it guessed at another width.
		expect(builds.length).toBeGreaterThanOrEqual(2);
		expect(builds[0].width).not.toBe(listWidth);
		expect(builds.at(-1)!.width).toBe(listWidth);
	});

	test('ten keystrokes in a nested item build no height table', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		await editor.clickBlockAtPath([...LIST_PATH, 0, 0], 4);
		// The first edit in a chain rebuilds each enclosing list once; the count starts after it.
		await page.keyboard.type('a');
		await editor.waitForRenderFlush();
		await resetPerf(page);

		await page.keyboard.type('bcdefghijk');
		await editor.waitForRenderFlush();

		expect(await heightTableBuilds(page)).toEqual([]);
	});

	test('a wheel scroll over the nested list builds no height table', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.waitForRenderFlush();
		const box = (await page.locator('.editor').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await resetPerf(page);

		await page.mouse.wheel(0, 600);
		await editor.waitForRenderFlush();

		expect(
			await page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop)
		).toBeGreaterThan(0);
		expect(await heightTableBuilds(page)).toEqual([]);
	});
});
