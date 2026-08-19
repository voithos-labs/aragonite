import { test } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('blockquote navigation — basic traversal', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown between two inner paragraphs', async () => {
		await editor.loadContent('> first\n>\n> second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: /^first$/ });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Zsecond$/m);
	});

	test('ArrowUp between two inner paragraphs', async () => {
		await editor.loadContent('> first\n>\n> second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: /^second$/ });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> firstZ$/m);
	});

	test('ArrowDown from last inner paragraph exits blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^[^>].*Z/m);
	});

	test('ArrowUp from first inner paragraph exits blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const quote = editor.page.locator('[contenteditable="true"]', { hasText: /^quote$/ });
		await quote.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^beforeZ$/m);
	});

	test('ArrowDown from paragraph before blockquote enters the blockquote', async () => {
		await editor.loadContent('before\n\n> quote\n');
		const before = editor.page.locator('[contenteditable="true"]', { hasText: /^before$/ });
		await before.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> Zquote$/m);
	});

	test('ArrowUp from paragraph after blockquote enters the blockquote', async () => {
		await editor.loadContent('> quote\n\nafter\n');
		const after = editor.page.locator('[contenteditable="true"]', { hasText: /^after$/ });
		await after.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> .*Z/m);
	});
});
