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

		expect(await editor.bridge.getSource()).not.toMatch(/^text2$/m);
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
		expect(source).not.toMatch(/^text$/m);
	});

	test('nested blockquote: merge recurses into deepest inner paragraph', async () => {
		await editor.loadContent('> > deep\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('> > deeptext');

		expect(await editor.bridge.getSource()).not.toMatch(/^text$/m);
	});

	test('blockquote with heading as last inner child: merge into heading raw', async () => {
		await editor.loadContent('> # Heading\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> # Headingtext$/m);

		expect(await editor.bridge.getSource()).not.toMatch(/^text$/m);
	});

	test('blockquote with opaque deepest leaf (fenced code): fall back to move-focus', async () => {
		await editor.loadContent('> para\n>\n> ```\n> code\n> ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');

		// The fallback moves focus into the opaque leaf and changes no bytes, so the
		// only observable is where the next keystroke lands. A timeout here IS the
		// failure: focus never moved, or landed somewhere untypable.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> para$/m);
		expect(source).toMatch(/^text$/m);
		expect(source).toContain('```');
		expect(source).toContain('code');
		// The marker landed inside the blockquote's fenced leaf — not back in the
		// paragraph the Backspace came from, and not in the quote's first child.
		expect(source).toMatch(/^> .*X/m);
	});
});
