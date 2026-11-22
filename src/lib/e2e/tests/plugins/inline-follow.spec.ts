import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';
import { PluginsPage, dragBetweenPoints } from './helpers';

/**
 * Styled inline text that follows a click (requirements/plugins/inline-follow.md): the `#work` tag
 * of `routes/test/plugins/note-refs`, an `inline({ class, follow })` whose `follow` records the tag.
 */

const TAGGED = 3;
const TAG = '.note-refs-tag';

const followed = (page: Page): Promise<string[]> =>
	page.evaluate(() => (window as { __followedTags?: string[] }).__followedTags ?? []);

/** A point inside the tag, a third of the way in, so a click lands between two of its letters. */
async function insideTag(page: Page): Promise<{ x: number; y: number }> {
	const box = await page.locator(TAG).boundingBox();
	if (!box) throw new Error('no tag on the page');
	return { x: box.x + box.width / 3, y: box.y + box.height / 2 };
}

test.describe('styled inline text that follows a click', () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins('note-refs');
		await ep.setPresentationMode('live');
		await expect(page.locator(TAG)).toHaveText('#work');
	});

	test('a plain click follows nothing and puts the caret in the tag', async ({ page }) => {
		const at = await insideTag(page);
		await page.mouse.click(at.x, at.y);
		await page.keyboard.type('Q');
		await ep.waitForRenderFlush();
		expect(await followed(page)).toEqual([]);
		// A capital ends the tag's match, so it sits in the tag's bytes wherever the click landed.
		expect(await ep.bridge.getSource()).toMatch(/Filed under #[a-z]*Q[a-z]+ today/);
	});

	test('a double click follows nothing and selects a word', async ({ page }) => {
		const at = await insideTag(page);
		await page.mouse.dblclick(at.x, at.y);
		await ep.waitForRenderFlush();
		expect(await followed(page)).toEqual([]);
		expect(await page.evaluate(() => getSelection()?.toString())).toContain('work');
	});

	test('the host’s link click follows with the tag’s data, the text still editable', async ({
		page
	}) => {
		const at = await insideTag(page);
		await page.keyboard.down('ControlOrMeta');
		await page.mouse.click(at.x, at.y);
		await page.keyboard.up('ControlOrMeta');
		await ep.waitForRenderFlush();
		expect(await followed(page)).toEqual(['work']);
		await ep.focusBlockEnd(TAGGED);
		await page.keyboard.type('!');
		await expect.poll(() => ep.bridge.getSource()).toContain('#work today.!');
	});

	test('a drag inside the tag selects and follows nothing, in reading mode too', async ({
		page
	}) => {
		for (const mode of ['live', 'reading'] as const) {
			await ep.setPresentationMode(mode);
			const box = (await page.locator(TAG).boundingBox())!;
			const y = box.y + box.height / 2;
			// Pressed and released on the tag, so the browser sends it a click after the drag.
			await dragBetweenPoints(page, { x: box.x + 2, y }, { x: box.x + box.width - 2, y });
			await ep.waitForRenderFlush();
			expect(await followed(page), mode).toEqual([]);
			expect(await page.evaluate(() => getSelection()?.toString()), mode).toContain('wor');
		}
	});

	test('reading mode follows a plain click, and a typed tag follows with its new data', async ({
		page
	}) => {
		await ep.focusBlockEnd(TAGGED);
		await page.keyboard.type(' #next');
		await expect(page.locator(TAG)).toHaveCount(2);
		await ep.setPresentationMode('reading');
		const box = (await page.locator(TAG).last().boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await ep.waitForRenderFlush();
		expect(await followed(page)).toEqual(['next']);
	});

	test('the tag adds no accessibility violation, live or reading', async ({ page }) => {
		await expectNoNewA11yViolations(page, 'inline-follow live');
		await ep.setPresentationMode('reading');
		await ep.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'inline-follow reading');
	});
});
