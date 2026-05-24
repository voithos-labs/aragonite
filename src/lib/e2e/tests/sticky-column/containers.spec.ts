import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: container traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('through blockquote preserves column', async () => {
		await editor.loadContent(
			'Long first paragraph with plenty of characters.\n\n> Quote line with text here.\n\nAnother long paragraph after the quote.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();
		const insideX = await editor.getCaretPixelX();
		expect(Math.abs(insideX - sourceX)).toBeLessThan(30);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();
		const afterX = await editor.getCaretPixelX();
		expect(Math.abs(afterX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('through list preserves column', async () => {
		await editor.loadContent(
			'Long first paragraph with enough characters.\n\n- Item one with text\n- Item two with text\n- Item three with text\n\nAfter the list long paragraph.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 15; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

test.describe('sticky column: transparent blocks', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('thematic break is transparent — column preserved through ---', async () => {
		await editor.loadContent(
			'Long paragraph before thematic break with lots of text.\n\n---\n\nLong paragraph after the thematic break with lots of text.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 25; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

test.describe('sticky column: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('capture in empty paragraph does not crash', async () => {
		await editor.loadContent('Above.\n\n\n\nBelow paragraph with text.\n');

		const editables = editor.page.locator('[contenteditable="true"]');
		const count = await editables.count();
		if (count >= 3) {
			await editables.nth(1).click();
			await editor.page.keyboard.press('ArrowDown');
			await editor.waitForStickyColumnSettle();

			const targetX = await editor.getCaretPixelX();
			const below = editables.nth(count - 1);
			const belowRect = await below.boundingBox();
			if (belowRect) {
				expect(Math.abs(targetX - belowRect.x)).toBeLessThan(20);
			}
		}
	});

	test('editor blur resets sticky column — blur, re-focus, fresh capture', async () => {
		await editor.loadContent(
			'Long first paragraph with plenty of characters.\n\nSecond long paragraph here.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 20; i++) await editor.page.keyboard.press('ArrowRight');

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();

		await editor.page.evaluate(() => (document.body as HTMLElement).focus());
		await editor.waitForStickyColumnSettle();

		await first.click();
		await editor.page.keyboard.press('Home');
		const postRefocusX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForStickyColumnSettle();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postRefocusX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});
});
