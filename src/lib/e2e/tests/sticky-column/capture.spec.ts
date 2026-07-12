import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: basic capture and cross-block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown preserves column when moving from long line to long line', async () => {
		await editor.loadContent(
			'Hello world this is the first paragraph.\n\nSecond paragraph is also quite long.\n'
		);

		const firstPara = editor.page.locator('[contenteditable="true"]').first();
		await firstPara.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();
		expect(sourceX).toBeGreaterThan(0);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('ArrowUp preserves column when moving from long line to long line', async () => {
		await editor.loadContent(
			'Hello world this is the first paragraph.\n\nSecond paragraph is also quite long.\n'
		);

		const secondPara = editor.page.locator('[contenteditable="true"]').nth(1);
		await secondPara.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});

test.describe('sticky column: survive intermediate clamping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown through a short block preserves original column in the next long block', async () => {
		await editor.loadContent(
			'A very long first paragraph with plenty of characters to start at a high column.\n\nShort.\n\nAnother long paragraph here with many characters to land in.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 40; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();
		expect(sourceX).toBeGreaterThan(100);

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('ArrowDown through multiple short blocks preserves original column in the final long block', async () => {
		await editor.loadContent(
			'Long line one with plenty of text to start at a high column position.\n\nA.\n\nB.\n\nC.\n\nAnother very long line with many characters near the far side.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 40; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
	});
});
