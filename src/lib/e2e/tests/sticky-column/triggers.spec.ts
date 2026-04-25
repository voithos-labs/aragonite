import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

const PIXEL_TOLERANCE = 5;

test.describe('sticky column: reset triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function setupHighColumn() {
		await editor.loadContent(
			'A long first paragraph with enough text to have a high-column position.\n\nShort.\n\nAnother long paragraph to test landing at the original column.\n'
		);
		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 30; i++) await editor.page.keyboard.press('ArrowRight');
	}

	test('typing resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.typeText('x');
		await editor.page.waitForTimeout(100);

		const preArrowX = await editor.getCaretPixelX();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - preArrowX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('click resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		const second = editor.page.locator('[contenteditable="true"]').nth(1);
		await second.click();
		await editor.page.keyboard.press('Home');

		const postClickX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postClickX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowLeft resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('ArrowLeft');
		await editor.page.waitForTimeout(50);

		const postArrowLeftX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postArrowLeftX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('ArrowRight resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('ArrowRight');
		await editor.page.waitForTimeout(50);

		const postRightX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		// *4 not *3: proportional-font char snap gap after ArrowRight lands at offset 1 of "Short.".
		// (If sticky weren't reset, the gap would be ~200px, not ~17px.)
		expect(Math.abs(targetX - postRightX)).toBeLessThan(PIXEL_TOLERANCE * 4);
	});

	test('End resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('End');
		await editor.page.waitForTimeout(50);

		const postEndX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postEndX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});

	test('Enter (split) resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(100);

		const postEnterX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postEnterX)).toBeLessThan(PIXEL_TOLERANCE * 5);
	});

	test('undo resets sticky column', async () => {
		await setupHighColumn();
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(100);
		await editor.page.keyboard.press('Control+z');
		await editor.page.waitForTimeout(100);

		const postUndoX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - postUndoX)).toBeLessThan(PIXEL_TOLERANCE * 5);
	});
});

test.describe('sticky column: preserve triggers', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown preserves sticky column', async () => {
		await editor.loadContent(
			'First long line with text.\n\nSecond long line with text.\n\nThird long line here.\n'
		);

		const first = editor.page.locator('[contenteditable="true"]').nth(0);
		await first.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 15; i++) await editor.page.keyboard.press('ArrowRight');

		const sourceX = await editor.getCaretPixelX();

		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.page.waitForTimeout(50);

		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(100);

		const targetX = await editor.getCaretPixelX();
		expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE * 3);
	});
});
