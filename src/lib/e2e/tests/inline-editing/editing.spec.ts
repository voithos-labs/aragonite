import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const INLINE_CONTENT = `A paragraph with **bold text** and *italic text* here.

A line with \`inline code\` in it.

A line with a [link](https://example.com) present.

Plain paragraph for editing.
`;

test.describe('inline editing — editing formatted content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(INLINE_CONTENT);
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
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('**bold**');
		await editor.bridge.waitForSourceContains('**bold**');

		const block = editor.getBlock(1);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
	});

	test('heading markers are dimmed after typing # to convert', async () => {
		// Regression: split-created paragraph converted to heading but marker lacked .md-marker class.
		await editor.loadContent('Some text.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('# New heading');
		await editor.bridge.waitForSourceContains('# New heading');

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
		await editor.bridge.waitForSourceContains('Hello. **bold**');

		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello. **bold**');
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
