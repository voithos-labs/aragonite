import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Fixtures separate the trailing paragraph from the list with a blank line: an
// under-indented line touching the list is a lazy continuation of the last item
// (CommonMark §5.2), so only the blank line makes it a distinct following block.
test.describe('cross-container merge on Backspace (list prev)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('flat unordered list: Backspace at start of following paragraph merges into last item', async () => {
		await editor.loadContent('- first\n- second\n\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^- secondtext$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- secondtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('flat ordered list: Backspace at start of following paragraph merges into last item without renumbering', async () => {
		await editor.loadContent('1. first\n2. second\n\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^1\. first$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. first$/m);
		expect(source).toMatch(/^2\. secondtext$/m);
		expect(source).not.toMatch(/^1\. secondtext$/m);
		expect(source).not.toMatch(/^3\./m);
	});

	test('nested list: merge recurses into deepest nested item paragraph', async () => {
		await editor.loadContent('- a\n  - b\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^- a$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- a$/m);
		expect(source).toMatch(/^\s+- btext$/m);
	});

	test('loose list item (multi-paragraph): merge lands in the LAST paragraph of the last item', async () => {
		await editor.loadContent('- first item\n\n- second item\n\n  second para\n\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/second paratext/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/second paratext/);
		expect(source).toMatch(/^- second item$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('list inside blockquote: merge recurses through both containers', async () => {
		await editor.loadContent('> - item\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('> - itemtext');
		const source = await editor.bridge.getSource();
		expect(source).toContain('> - itemtext');
		expect(source).not.toMatch(/^text$/m);
	});

	test('list with opaque deepest leaf: fall back to move-focus', async () => {
		await editor.loadContent('- item\n\n  ```\n  code\n  ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^- item$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^text$/m);
		expect(source).toContain('code');
	});
});
