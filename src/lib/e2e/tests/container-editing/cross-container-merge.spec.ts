import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-container merge on Backspace (blockquote prev)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('flat blockquote: Backspace at start of following paragraph merges into inner paragraph', async () => {
		// Blank-line separator is required due to CommonMark §5.1 lazy continuation.
		await editor.loadContent('> text\n\ntext2\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text2$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> texttext2$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> texttext2$/m);
		expect(source).not.toMatch(/^text2$/m);
	});

	test('flat blockquote: caret lands at the join point after merge', async () => {
		await editor.loadContent('> text\n\ntext2\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text2$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> texttext2$/m);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/^> textZtext2$/m);
		expect(await editor.bridge.getSource()).toMatch(/^> textZtext2$/m);
	});

	test('multi-paragraph blockquote: only the last inner paragraph receives the merge', async () => {
		await editor.loadContent('> first\n>\n> second\n\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> secondtext$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> first$/m);
		expect(source).toMatch(/^> secondtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('nested blockquote: merge recurses into deepest inner paragraph', async () => {
		await editor.loadContent('> > deep\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('> > deeptext');
		const source = await editor.bridge.getSource();
		expect(source).toContain('> > deeptext');
		expect(source).not.toMatch(/^text$/m);
	});

	test('blockquote with heading as last inner child: merge into heading raw', async () => {
		await editor.loadContent('> # Heading\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> # Headingtext$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> # Headingtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('blockquote with opaque deepest leaf (fenced code): fall back to move-focus', async () => {
		await editor.loadContent('> para\n>\n> ```\n> code\n> ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		// wait 200ms — fall-back move-focus produces no source change; verify state is stable.
		await editor.bridge.waitForSourceMatches(/^> para$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> para$/m);
		expect(source).toMatch(/^text$/m);
		expect(source).toContain('```');
		expect(source).toContain('code');
	});
});
