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
// Items long enough to wrap onto more lines at the list's width than at the editor's.
const LONG_DOC =
	Array.from(
		{ length: ITEMS },
		(_, i) => `${QUOTE}- item ${i} ${'word '.repeat(40 + (i % 7) * 6)}`
	).join('\n') + '\n';
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

	// The items below the window never mounted, so the bottom spacer is made of guesses alone,
	// and the guesses carried from the first table were made at the editor's width.
	test('the items below the window keep heights guessed at the list width', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LONG_DOC);
		await editor.waitForRenderFlush();

		const heights = await page.evaluate((path) => {
			const probes = (window as any).__test;
			let list = probes.getDocument();
			for (const i of path) list = list.children[i];
			const box = document.querySelector(
				`[data-block-path='${JSON.stringify(path)}'] .list-block`
			) as HTMLElement;
			const mounted = [...box.querySelectorAll('[data-block-path]')]
				.map((el) => JSON.parse(el.getAttribute('data-block-path')!) as number[])
				.filter((blockPath) => blockPath.length > path.length);
			const end = Math.max(...mounted.map((blockPath) => blockPath[path.length])) + 1;
			const guessAt = (width: number) =>
				list.children
					.slice(end)
					.reduce(
						(sum: number, item: any) => sum + probes.getHeightOracle().estimate(item, width),
						0
					);
			const spacer = box.querySelector(':scope > .vr-spacer:last-child') as HTMLElement;
			return {
				tail: list.children.length - end,
				spacer: spacer.offsetHeight,
				atList: guessAt(box.clientWidth),
				atPort: guessAt((document.querySelector('.editor') as HTMLElement).clientWidth)
			};
		}, LIST_PATH);

		expect(heights.tail).toBeGreaterThan(0);
		// The fixture is only a check where the two widths guess differently.
		expect(heights.atList).toBeGreaterThan(heights.atPort);
		expect(heights.spacer).toBe(heights.atList);
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
