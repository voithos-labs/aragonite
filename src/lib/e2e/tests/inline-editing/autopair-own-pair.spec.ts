import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The auto-pair steps over, collapses or deletes only the empty pair it wrote itself. Two
// delimiters it did not write as a pair are the user's, and a key between them touches one byte.
// Each case types after `a ` so the pair sits in prose, not on a line of its own.

test.describe('inline editing, the pair the auto-pair wrote', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('source');
		await editor.loadContent('a \n');
		await editor.focusBlock(0, 2);
	});

	test('a space typed between the stars of a typed `**b` keeps both', async ({ page }) => {
		await page.keyboard.type('**b');
		await editor.bridge.waitForSourceEquals('a **b**\n');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type(' ');

		await expect.poll(() => editor.bridge.getSource()).toBe('a * *b**\n');
	});

	test('a space typed between the underscores of a typed `__b` keeps both', async ({ page }) => {
		await page.keyboard.type('__b');
		await editor.bridge.waitForSourceEquals('a __b__\n');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type(' ');

		await expect.poll(() => editor.bridge.getSource()).toBe('a _ _b__\n');
	});

	test('Backspace between the stars of a typed `**b` takes one', async ({ page }) => {
		await page.keyboard.type('**b');
		await editor.bridge.waitForSourceEquals('a **b**\n');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('a *b**\n');
	});

	// Typing inside the pair keeps it the auto-pair's, so once it is empty again Backspace
	// still takes both stars.
	test('Backspace takes both stars of a pair emptied after typing in it', async ({ page }) => {
		await page.keyboard.type('*b');
		await editor.bridge.waitForSourceEquals('a *b*\n');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('a **\n');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('x');

		await expect.poll(() => editor.bridge.getSource()).toBe('a x\n');
	});
});

// Each editor keeps its own record, so a key typed in another editor leaves this one's pair its
// own: the next star grows it rather than landing as a plain byte.
test('a key in another editor leaves the pair the auto-pair wrote its own', async ({ page }) => {
	await page.goto('/test/multi-editor');
	await page.waitForFunction(
		() => (window as unknown as { __editorsReady?: boolean }).__editorsReady === true
	);
	const [left, right] = [page.locator('.editor').nth(0), page.locator('.editor').nth(1)];
	const alpha = left.locator('[contenteditable="true"]', { hasText: 'Alpha' });
	await alpha.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' *');
	await expect(alpha).toHaveText('Alpha paragraph **');

	await right.locator('[contenteditable="true"]', { hasText: 'Beta' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type('x');
	await alpha.click();
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.type('*');

	await expect(alpha).toHaveText('Alpha paragraph ****');
});
