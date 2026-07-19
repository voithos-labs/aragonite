import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('inline editing — entity references', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
	});

	test('named entity renders styled with source intact', async () => {
		await editor.typeText('a &copy; b');
		await editor.bridge.waitForSourceContains('a &copy; b');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(1);
		await expect(block.locator('.md-entity')).toHaveText('&copy;');
		expect((await editor.bridge.getSource()).trim()).toBe('a &copy; b');
	});

	test('decimal numeric entity recognized', async () => {
		await editor.typeText('quote &#39; here');
		await editor.bridge.waitForSourceContains('quote &#39; here');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(1);
	});

	test('hex numeric entity (lowercase x) recognized', async () => {
		await editor.typeText('quote &#x22; here');
		await editor.bridge.waitForSourceContains('quote &#x22; here');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(1);
	});

	test('hex numeric entity (uppercase X) recognized', async () => {
		await editor.typeText('quote &#X22; here');
		await editor.bridge.waitForSourceContains('quote &#X22; here');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(1);
	});

	test('partial entity stays as text and resolves once closed', async () => {
		await editor.typeText('&am');
		await editor.bridge.waitForSourceContains('&am');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(0);

		await editor.typeText('p;');
		await editor.bridge.waitForSourceContains('&amp;');
		await expect(block.locator('.md-entity')).toHaveCount(1);
	});

	test('invalid entity stays as text', async () => {
		await editor.typeText('foo &notreal; bar');
		await editor.bridge.waitForSourceContains('foo &notreal; bar');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(0);
	});

	test('entity composes with surrounding emphasis', async () => {
		await editor.typeText('*&copy;*');
		await editor.bridge.waitForSourceContains('*&copy;*');

		const block = editor.getBlock(0);
		await expect(block.locator('em > .md-entity')).toHaveCount(1);
	});

	test('entity inside code span is inert', async () => {
		await editor.typeText('`&copy;`');
		await editor.bridge.waitForSourceContains('`&copy;`');

		const block = editor.getBlock(0);
		await expect(block.locator('.md-entity')).toHaveCount(0);
		await expect(block.locator('code.inline-code-content')).toHaveCount(1);
	});

	for (const sample of ['&copy;', '&amp;', '&#39;', '&#x22;', '&notreal;']) {
		test(`round-trips ${JSON.stringify(sample)} unchanged`, async () => {
			await editor.typeText(sample);
			await editor.bridge.waitForSourceContains(sample);
			expect((await editor.bridge.getSource()).trim()).toBe(sample);
		});
	}

	test('entity inside link text renders inside anchor', async () => {
		await editor.typeText('[&copy; me](https://example.com)');
		await editor.bridge.waitForSourceContains('[&copy; me](https://example.com)');
		const block = editor.getBlock(0);
		expect(await block.locator('a .md-entity').count()).toBe(1);
	});

	test('backspacing the closing ; collapses entity to plain text', async () => {
		await editor.loadContent('&copy;\n');
		await editor.focusBlockAtPath([0], 6);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('&copy');
		const block = editor.getBlock(0);
		expect(await block.locator('.md-entity').count()).toBe(0);
	});
});
