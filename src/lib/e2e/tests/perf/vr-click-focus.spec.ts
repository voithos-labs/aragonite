import type { Locator } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage, clickWidgetCenter } from '../plugins/helpers';

/**
 * A click into a block leaves the scroll position where it was, whatever the click reveals. The
 * focus a click lands through must not scroll, and the height correction holds the clicked block
 * still while a block above it changes height.
 */

const pad = (label: string) =>
	Array.from({ length: 30 }, (_, i) => `${label} padding line ${i}.`).join('\n\n');
const PARAGRAPH = 30;
const DOC =
	`${pad('Above')}\n\n` +
	'A paragraph somebody clicks into, somewhere in the middle of the page.\n\n' +
	// One line rendered, six lines of source: opening it makes the block much taller.
	'$$\nx^2\n+ y^2\n+ z^2\n+ w^2\n+ v^2\n= 1\n$$\n\n' +
	'Inline math $a^2 + b^2$ sitting in a sentence.\n\n' +
	`${pad('Below')}\n`;

const SCROLL_TOLERANCE = 1;

class ClickFocusPage extends PluginsPage {
	scrollTop(): Promise<number> {
		return this.page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
	}

	/** Frames until `scrollTop` holds still for five in a row, so a slow machine waits longer. */
	async settle(): Promise<void> {
		await this.page.evaluate(async () => {
			const editor = document.querySelector('.editor') as HTMLElement;
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			let last = editor.scrollTop;
			for (let held = 0, i = 0; held < 5 && i < 180; i++) {
				await frame();
				if (editor.scrollTop === last) held++;
				else {
					held = 0;
					last = editor.scrollTop;
				}
			}
		});
	}

	/** Scrolls so `target` sits mid-viewport, where its growth can't push it off screen, and
	 *  returns the settled `scrollTop`. */
	async centre(target: Locator): Promise<number> {
		await target.evaluate((el) => {
			const editor = document.querySelector('.editor') as HTMLElement;
			const er = editor.getBoundingClientRect();
			const tr = el.getBoundingClientRect();
			editor.scrollTop += tr.top - er.top - (editor.clientHeight - tr.height) / 2;
		});
		await this.settle();
		return this.scrollTop();
	}
}

test.describe('a click into a block leaves the scroll position alone', () => {
	let editor: ClickFocusPage;

	test.beforeEach(async ({ page }) => {
		editor = new ClickFocusPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(DOC);
		await expect(page.locator('.math-block-render')).toHaveCount(1);
		const overflows = await page.evaluate(() => {
			const el = document.querySelector('.editor') as HTMLElement;
			return el.scrollHeight > el.clientHeight;
		});
		expect(overflows, 'the fixture must scroll, or a held position proves nothing').toBe(true);
	});

	test('a click into a paragraph', async () => {
		const paragraph = editor.getBlock(PARAGRAPH);
		const before = await editor.centre(paragraph);
		expect(before).toBeGreaterThan(SCROLL_TOLERANCE);

		const box = await paragraph.boundingBox();
		if (!box) throw new Error('paragraph has no bounding box');
		await paragraph.click({ position: { x: box.width / 3, y: box.height / 2 } });
		await editor.settle();

		expect(Math.abs((await editor.scrollTop()) - before)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
	});

	test('a click on a block math render, which shows its taller source', async ({ page }) => {
		const render = page.locator('.math-block-render');
		const before = await editor.centre(render);
		expect(before).toBeGreaterThan(SCROLL_TOLERANCE);

		await clickWidgetCenter(render);
		await expect(page.locator('.math-block-source')).toHaveCount(1);
		await editor.settle();

		expect(Math.abs((await editor.scrollTop()) - before)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
	});

	test('a click on an inline math widget, which shows its source in the line', async ({ page }) => {
		const widget = page.locator('.math-inline-widget');
		const before = await editor.centre(widget);
		expect(before).toBeGreaterThan(SCROLL_TOLERANCE);

		await clickWidgetCenter(widget);
		await expect(widget).toHaveCount(0);
		await editor.settle();

		expect(Math.abs((await editor.scrollTop()) - before)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
	});

	// The one case where holding the clicked block and holding the top block disagree: the block
	// above shrinks as the click lands, so only holding the clicked one keeps it under the pointer.
	test('a click below an open display formula keeps the clicked line under the pointer', async ({
		page
	}) => {
		const widget = page.locator('.math-inline-widget');
		const line = editor.getBlock(PARAGRAPH + 2);
		await editor.centre(widget);
		await clickWidgetCenter(page.locator('.math-block-render'));
		await expect(page.locator('.math-block-source')).toHaveCount(1);
		await editor.settle();
		expect(await editor.scrollTop()).toBeGreaterThan(SCROLL_TOLERANCE);
		const lineTop = (await line.boundingBox())?.y ?? NaN;

		await clickWidgetCenter(widget);
		await expect(page.locator('.math-block-render')).toHaveCount(1);
		await expect(widget).toHaveCount(0);
		await editor.settle();

		const after = (await line.boundingBox())?.y ?? NaN;
		expect(Math.abs(after - lineTop)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
	});
});
