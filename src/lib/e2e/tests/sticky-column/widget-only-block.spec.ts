import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A paragraph whose only content is a run of entity widgets: the caret can sit at their
// boundaries and nowhere else, and every one of those positions measures to no box of its own.
// Requirements: `e2e/requirements/sticky-column/widget-only-block.md`.

const PARAGRAPH = 'a'.repeat(30);
const ENTITIES = '&amp;'.repeat(10);
const DOC = `${PARAGRAPH}\n\n${ENTITIES}\n\n${PARAGRAPH}\n`;
const COLUMN = 20;

async function clickColumnInFirstParagraph(editor: EditorPage): Promise<void> {
	await editor.page.locator('[contenteditable="true"]').nth(0).click();
	await editor.page.keyboard.press('Home');
	for (let i = 0; i < COLUMN; i++) await editor.page.keyboard.press('ArrowRight');
	await editor.waitForRenderFlush();
}

/** The right edge of the last entity widget: the column a click past the run lands on. */
function lastWidgetRight(page: Page): Promise<number> {
	return page.evaluate(() => {
		const widgets = document.querySelectorAll('[data-inline-widget]');
		return widgets[widgets.length - 1].getBoundingClientRect().right;
	});
}

/** The middle of the entity run's line, so a click beside it is on its own row. */
function entityRowY(page: Page): Promise<number> {
	return page.evaluate(() => {
		const box = document.querySelector('[data-inline-widget]')!.getBoundingClientRect();
		return box.top + box.height / 2;
	});
}

/** The width of one character of the last paragraph: the bound a column landing rounds by. */
function characterWidth(page: Page): Promise<number> {
	return page.evaluate(() => {
		const surfaces = document.querySelectorAll('[contenteditable="true"]');
		const range = document.createRange();
		range.setStart(surfaces[2].firstChild!, 0);
		range.setEnd(surfaces[2].firstChild!, 1);
		return range.getBoundingClientRect().width;
	});
}

test.describe('sticky column: a paragraph whose only content is widgets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('ArrowDown from a column past the run lands at the run’s trailing edge', async ({
		page
	}) => {
		await clickColumnInFirstParagraph(editor);
		await page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await page.keyboard.press('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('&amp;X');
		expect(src).not.toContain('X&amp;');
	});

	test('ArrowDown from the start of the line lands at the run’s leading edge', async ({ page }) => {
		await editor.page.locator('[contenteditable="true"]').nth(0).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await page.keyboard.press('X');
		const src = await editor.bridge.getSource();
		expect(src).toContain('X&amp;');
		expect(src).not.toContain('&amp;X');
	});

	test('a caret beside a widget takes that widget’s edge as its column when it leaves', async ({
		page
	}) => {
		const widgetRight = await lastWidgetRight(page);
		await page.mouse.click(widgetRight + 30, await entityRowY(page));
		await editor.waitForRenderFlush();
		await page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		const landingX = await editor.getCaretPixelX();
		expect(Math.abs(landingX - widgetRight)).toBeLessThan((await characterWidth(page)) + 2);
	});

	test('the column survives a walk down through the run and back up', async ({ page }) => {
		await clickColumnInFirstParagraph(editor);
		const columnX = await editor.getCaretPixelX();
		for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp']) {
			await page.keyboard.press(key);
			await editor.waitForRenderFlush();
		}
		expect(await editor.bridge.getSelectionPaths()).toMatchObject({ anchor: { path: [0] } });
		expect(Math.abs((await editor.getCaretPixelX()) - columnX)).toBeLessThan(2);
	});
});
