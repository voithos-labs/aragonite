import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Recognition + composition of character references
// (requirements/inline-editing/entity-references.md). The atomic caret/delete behavior of
// the resulting widget is a separate concern, pinned in entity-widget.spec.ts.

test.describe('inline editing — entity references', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('');
		await editor.focusBlockAtPath([0], 0);
	});

	test('named entity renders as its glyph widget with source intact', async () => {
		await editor.typeText('a &copy; b');
		await editor.bridge.waitForSourceContains('a &copy; b');

		const widget = editor.getBlock(0).locator('[data-inline-widget]');
		await expect(widget).toHaveCount(1);
		await expect(widget).toHaveText('©');
		expect((await editor.bridge.getSource()).trim()).toBe('a &copy; b');
	});

	test('decimal numeric entity renders its glyph', async () => {
		await editor.typeText('quote &#39; here');
		await editor.bridge.waitForSourceContains('quote &#39; here');
		await expect(editor.getBlock(0).locator('[data-inline-widget]')).toHaveCount(1);
	});

	test('hex numeric entity (lowercase x) renders its glyph', async () => {
		await editor.typeText('quote &#x22; here');
		await editor.bridge.waitForSourceContains('quote &#x22; here');
		await expect(editor.getBlock(0).locator('[data-inline-widget]')).toHaveCount(1);
	});

	test('hex numeric entity (uppercase X) renders its glyph', async () => {
		await editor.typeText('quote &#X22; here');
		await editor.bridge.waitForSourceContains('quote &#X22; here');
		await expect(editor.getBlock(0).locator('[data-inline-widget]')).toHaveCount(1);
	});

	test('partial entity stays as text and renders its glyph once closed', async () => {
		await editor.typeText('&am');
		await editor.bridge.waitForSourceContains('&am');

		const block = editor.getBlock(0);
		await expect(block.locator('[data-inline-widget]')).toHaveCount(0);

		await editor.typeText('p;');
		await editor.bridge.waitForSourceContains('&amp;');
		await expect(block.locator('[data-inline-widget]')).toHaveCount(1);
	});

	test('invalid entity stays as text', async () => {
		await editor.typeText('foo &notreal; bar');
		await editor.bridge.waitForSourceContains('foo &notreal; bar');
		await expect(editor.getBlock(0).locator('[data-inline-widget]')).toHaveCount(0);
	});

	test('entity composes with surrounding emphasis', async () => {
		await editor.typeText('*&copy;*');
		await editor.bridge.waitForSourceContains('*&copy;*');
		await expect(editor.getBlock(0).locator('em > [data-inline-widget]')).toHaveCount(1);
	});

	test('entity inside code span is inert', async () => {
		await editor.typeText('`&copy;`');
		await editor.bridge.waitForSourceContains('`&copy;`');

		const block = editor.getBlock(0);
		await expect(block.locator('[data-inline-widget]')).toHaveCount(0);
		await expect(block.locator('code.inline-code-content')).toHaveCount(1);
	});

	for (const sample of ['&copy;', '&amp;', '&#39;', '&#x22;', '&notreal;']) {
		test(`round-trips ${JSON.stringify(sample)} unchanged`, async () => {
			await editor.typeText(sample);
			await editor.bridge.waitForSourceContains(sample);
			expect((await editor.bridge.getSource()).trim()).toBe(sample);
		});
	}

	test('entity inside link text renders its glyph inside the anchor', async () => {
		await editor.typeText('[&copy; me](https://example.com)');
		await editor.bridge.waitForSourceContains('[&copy; me](https://example.com)');
		expect(await editor.getBlock(0).locator('a [data-inline-widget]').count()).toBe(1);
	});
});
