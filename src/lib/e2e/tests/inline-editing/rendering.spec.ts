import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const INLINE_CONTENT = `A paragraph with **bold text** and *italic text* here.

A line with \`inline code\` in it.

A line with a [link](https://example.com) present.

Plain paragraph for editing.
`;

test.describe('inline editing — rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(INLINE_CONTENT);
	});

	test('bold text renders with <strong> element', async () => {
		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toHaveText('bold text');
	});

	test('italic text renders with <em> element', async () => {
		const block = editor.getBlock(0);
		await expect(block.locator('em')).toHaveCount(1);
		await expect(block.locator('em')).toHaveText('italic text');
	});

	test('inline code renders with backtick markers and <code> element', async () => {
		const block = editor.getBlock(1);
		await expect(block.locator('code.inline-code-content')).toHaveCount(1);
		await expect(block.locator('code.inline-code-content')).toHaveText('inline code');
		const markers = block.locator('.md-marker');
		const count = await markers.count();
		expect(count).toBeGreaterThanOrEqual(2);
	});

	test('link renders with <a> element', async () => {
		const block = editor.getBlock(2);
		await expect(block.locator('a.md-link-content')).toHaveCount(1);
		await expect(block.locator('a.md-link-content')).toHaveText('link');
	});

	test('nested formatting renders (bold wrapping italic)', async () => {
		const nested = '**bold *and italic* rest**';
		await editor.loadContent(`${nested}\n`);
		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong em')).toHaveCount(1);
		await expect(block.locator('strong em')).toHaveText('and italic');
	});
});
