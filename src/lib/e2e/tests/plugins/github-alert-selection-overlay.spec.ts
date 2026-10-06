import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, dragBetweenPoints } from './helpers';
import { textRunCenter } from '../../text-runs';
import { holes, paintedBands, paintedRegion, unpaintedMiddle } from '../selection/painted-region';

/**
 * A GitHub alert caught in a cross-block selection (requirements/plugins/github-alert-selection-
 * overlay.md). Its title row is drawn from the `[!WARNING]` marker and has no child block to paint
 * it, so a block the range covers whole must take one box over everything it renders.
 */

const ALERT_DOC = 'above\n\n> [!WARNING]\n> body line\n\nbelow\n';
const ALERT_OVERLAY = "[data-block-path='[1]'] > .selection-overlay-middle";

/** The painted box, and whether the title row's band falls inside it. */
async function boxCoversTitle(page: Page): Promise<boolean> {
	const box = (await page.locator(ALERT_OVERLAY).boundingBox())!;
	const title = (await page.locator('.admonition-title').boundingBox())!;
	expect(title.height).toBeGreaterThan(0);
	return title.y >= box.y - 1 && title.y + title.height <= box.y + box.height + 1;
}

/** How many painted selection rects cover the middle of the title row. */
async function paintsOverTitle(page: Page): Promise<number> {
	return page.evaluate(() => {
		const title = document.querySelector('.admonition-title')!.getBoundingClientRect();
		const x = title.left + title.width / 2;
		const y = title.top + title.height / 2;
		return [...document.querySelectorAll('.selection-overlay')]
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.left <= x && x <= r.right && r.top <= y && y <= r.bottom).length;
	});
}

test.describe('cross-block selection overlay - a GitHub alert held whole', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
		await editor.loadContent(ALERT_DOC);
	});

	test('the painted box covers the title row, not just the body', async ({ page }) => {
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(1);
		expect(await boxCoversTitle(page)).toBe(true);
	});

	// Endpoints land mid-word, not at the block edges.
	test('a pointer drag across the alert paints the same one box', async ({ page }) => {
		await dragBetweenPoints(
			page,
			await textRunCenter(page, 'above', { path: [0] }),
			await textRunCenter(page, 'below', { path: [2] })
		);
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(1);
		expect(await boxCoversTitle(page)).toBe(true);
	});

	test('the body block inside it paints nothing, so the highlight never doubles', async ({
		page
	}) => {
		await editor.focusBlockStart(0);
		await page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(1);
		await expect(
			page.locator("[data-block-path='[1]'] [data-block-path] .selection-overlay")
		).toHaveCount(0);
	});

	// The range cuts through the alert, so no one box can stand for it: its body block paints its
	// own endpoint rects, and the title row between the range's ends is painted once.
	test('a range ending inside the alert leaves the box to the body block', async ({ page }) => {
		await editor.focusBlockStart(0);
		await editor.shiftClickBlock([1, 0], 4);
		await editor.waitForCrossBlock(true);

		await expect(page.locator(ALERT_OVERLAY)).toHaveCount(0);
		await expect(
			page.locator("[data-block-path='[1,0]'] .selection-overlay-endpoint")
		).not.toHaveCount(0);
		await expect.poll(() => paintsOverTitle(page)).toBe(1);
	});
});

// The demo page's "Punishing Evil" section, selected from mid callout body to mid last item.
test.describe('cross-block selection overlay - a range from inside a GitHub alert', () => {
	const DOC = [
		'> [!WARNING]',
		"> In the name of the Moon, I'll punish you!",
		'',
		'',
		'1. Fighting evil by moonlight,',
		'2. winning love by daylight,',
		'3. never running from a real fight,',
		'4. she is the one named Sailor Moon!',
		''
	].join('\n');

	for (const mode of ['source', 'live']) {
		test(`${mode}: paints one region, the blank lines and the alert's padding included`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('admonitions');
			await editor.setPresentationMode(mode);
			await editor.loadContent(DOC);
			const body = await textRunCenter(page, 'the Moon', { path: [0, 0] });
			const item = await textRunCenter(page, 'Sailor', { path: [2, 3, 0] });
			await dragBetweenPoints(page, body, item);
			await editor.waitForCrossBlock(true);

			expect(holes(await paintedBands(page))).toEqual([]);
		});
	}
});

// The alert's inset beside its body is part of every line between the range's first and last.
test.describe('cross-block selection overlay - the lines between span the column', () => {
	for (const mode of ['source', 'live']) {
		test(`${mode}: from mid-callout, its inset painted`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('admonitions');
			await editor.setPresentationMode(mode);
			await editor.loadContent('> [!NOTE]\n> body line one\n> body line two\n\nafter the note\n');
			await editor.focusBlockAtPath([0, 0], 5);
			await editor.shiftClickBlock([1], 3);
			await editor.waitForCrossBlock(true);

			await expect.poll(async () => unpaintedMiddle(await paintedRegion(page))).toEqual([]);
		});
	}
});
