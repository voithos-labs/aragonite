/**
 * Cross-container merge on Backspace when prev block is a list.
 * Requirements: e2e/requirements/blocks/list/cross-container.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('cross-container merge on Backspace (list prev)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('flat unordered list: Backspace at start of following paragraph merges into last item', async () => {
		await editor.loadContent('- first\n- second\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^- secondtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('flat ordered list: Backspace at start of following paragraph merges into last item without renumbering', async () => {
		await editor.loadContent('1. first\n2. second\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^1\. first$/m);
		expect(source).toMatch(/^2\. secondtext$/m);
		// Guard against a renumbering bug that promotes 2. → 1.
		expect(source).not.toMatch(/^1\. secondtext$/m);
		expect(source).not.toMatch(/^3\./m);
	});

	test('nested list: merge recurses into deepest nested item paragraph', async () => {
		await editor.loadContent('- a\n  - b\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^- a$/m);
		expect(source).toMatch(/^\s+- btext$/m);
	});

	test('loose list item (multi-paragraph): merge lands in the LAST paragraph of the last item', async () => {
		// A "loose" list item has a blank line between its paragraphs, making
		// each paragraph a distinct child of the listItem. The walker descends
		// to the last child, which is the second paragraph "second para".
		await editor.loadContent('- first item\n\n- second item\n\n  second para\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// "second para" (the last paragraph of the last loose item) receives the merge
		expect(source).toMatch(/second paratext/);
		// The first paragraph of the last item is untouched
		expect(source).toMatch(/^- second item$/m);
		// "text" is gone from the top level
		expect(source).not.toMatch(/^text$/m);
	});

	test('list inside blockquote: merge recurses through both containers', async () => {
		await editor.loadContent('> - item\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('> - itemtext');
		expect(source).not.toMatch(/^text$/m);
	});

	test('list with opaque deepest leaf: fall back to move-focus', async () => {
		await editor.loadContent('- item\n\n  ```\n  code\n  ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// No merge — the list item and the following paragraph stay separate
		const source = await editor.getSource();
		// List item is still present and unchanged — no merge happened
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^text$/m);
		expect(source).toContain('code');
	});
});
