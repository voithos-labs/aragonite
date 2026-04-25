import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

const INLINE_CONTENT = `A paragraph with **bold text** and *italic text* here.

A line with \`inline code\` in it.

A line with a [link](https://example.com) present.

Plain paragraph for editing.
`;

test.describe('inline editing', () => {
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

	test('typing after bold span preserves formatting in source', async () => {
		await editor.focusBlockEnd(0);
		await editor.typeText(' tail');
		const src = await editor.bridge.getSource();
		expect(src).toContain('**bold text**');
		expect(src).toContain('tail');
	});

	test('source round-trips after editing formatted content', async () => {
		await editor.focusBlockEnd(1);
		await editor.typeText(' more');
		const src = await editor.bridge.getSource();
		expect(src).toContain('`inline code`');
		expect(src).toContain('more');
	});

	test('editing does not corrupt inline bold markers', async () => {
		await editor.focusBlockStart(0);
		await editor.typeText('Prefix: ');
		const src = await editor.bridge.getSource();
		expect(src).toContain('**bold text**');
		expect(src).toContain('*italic text*');
		expect(src).toContain('Prefix: ');
	});

	test('nested formatting renders (bold wrapping italic)', async () => {
		const nested = '**bold *and italic* rest**';
		await editor.loadContent(`${nested}\n`);
		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong em')).toHaveCount(1);
		await expect(block.locator('strong em')).toHaveText('and italic');
	});

	test('click into formatted paragraph, type at end, source updates', async () => {
		await editor.clickBlock(0);
		await editor.focusBlockEnd(0);
		await editor.typeText(' appended');
		const src = await editor.bridge.getSource();
		expect(src).toContain('**bold text**');
		expect(src).toContain('appended');
	});

	test('typing bold in a split-created block renders strong element', async () => {
		// Regression: split-created blocks had no inlineContent, so bold rendered as plain **text**.
		await editor.loadContent('First paragraph.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);

		await editor.typeSlowly('**bold**');
		await editor.page.waitForTimeout(200);

		const block = editor.getBlock(1);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
	});

	test('heading markers are dimmed after typing # to convert', async () => {
		// Regression: split-created paragraph converted to heading but marker lacked .md-marker class.
		await editor.loadContent('Some text.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);

		await editor.typeSlowly('# New heading');
		await editor.page.waitForTimeout(200);

		const block = editor.getBlock(1);
		await expect(block.locator('.md-marker')).toHaveCount(1);
		const markerText = await block.locator('.md-marker').textContent();
		expect(markerText).toBe('# ');
	});

	test('character-by-character typing produces correct bold rendering', async () => {
		// Regression: per-character keyboard.type() reversed text via double DOM rebuild.
		await editor.loadContent('Hello.\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' **bold**');
		await editor.page.waitForTimeout(200);

		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello. **bold**');
	});

	test('Ctrl+B wraps selection with **', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello **world**');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello **world**');
	});

	test('Ctrl+B on already-bold text removes **', async () => {
		await editor.loadContent('Hello **world**\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 9; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello world');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
		expect(source).not.toContain('**');
	});

	test('Ctrl+I wraps selection with *', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('Hello *world*');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello *world*');
	});

	test('Ctrl+I on already-italic text removes *', async () => {
		await editor.loadContent('Hello *world*\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 7; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+i');
		await editor.bridge.waitForSourceContains('Hello world');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
		expect(source).not.toContain('*');
	});

	// Regression: selecting inner word of `**word**` and pressing Ctrl+B used to double-wrap to `****word****`.
	test('Ctrl+B on word flanked by markers strips them rather than double-wrapping', async () => {
		await editor.loadContent('Hello **world** today\n');
		await editor.focusBlock(0, 8);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.keyboard.press('Control+b');
		await editor.bridge.waitForSourceContains('Hello world today');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world today');
		expect(source).not.toContain('****');
	});

	test('Ctrl+B with no selection is a no-op', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Control+b');
		await editor.page.waitForTimeout(200);
		const source = await editor.bridge.getSource();
		expect(source).toBe('Hello world\n');
	});

	test('split paragraph with inline formatting preserves both halves', async () => {
		await editor.loadContent(`before **bold** after\n`);
		await editor.focusBlock(0, 7);

		await editor.page.keyboard.press('Enter');
		expect(await editor.getDomBlockCount()).toBe(2);
		const src = await editor.bridge.getSource();
		expect(src).toContain('before');
		expect(src).toContain('**bold** after');
	});
});
