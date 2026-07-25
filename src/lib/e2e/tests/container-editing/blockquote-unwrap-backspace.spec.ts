import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('blockquote unwrap on Backspace (Rule U2)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('single-paragraph blockquote: Backspace at start lifts paragraph, deletes blockquote', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !s.includes('> '));

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('> ');
		expect(source).toContain('Hello world');
	});

	test('multi-paragraph blockquote: Backspace at start lifts only the first paragraph', async () => {
		await editor.loadContent('> First\n>\n> Second\n');
		const firstInner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await firstInner.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^First/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).toMatch(/^> Second/m);
	});

	test('nested blockquote: Backspace inside inner lifts content one level', async () => {
		await editor.loadContent('> > Deep\n');
		const deepEditable = editor.page.locator(
			'.blockquote-block .blockquote-block [contenteditable="true"]'
		);
		await deepEditable.first().click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => s.includes('> Deep') && !s.includes('> > '));

		const source = await editor.bridge.getSource();
		expect(source).toContain('> Deep');
		expect(source).not.toContain('> > ');
	});

	test('blockquote preceded by paragraph: no auto-merge', async () => {
		await editor.loadContent('Above paragraph.\n\n> Hello\n');
		const inner = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/Above paragraph\.\n\s*\nHello/);

		const source = await editor.bridge.getSource();
		expect(source).toContain('Above paragraph.');
		expect(source).toContain('Hello');
		expect(source).not.toContain('Above paragraph.Hello');
		expect(source).toMatch(/Above paragraph\.\n\s*\nHello/);
	});

	test('blockquote containing a list: Backspace at start of list item unwraps inside blockquote', async () => {
		await editor.loadContent('> - Item\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('> Item');

		const source = await editor.bridge.getSource();
		expect(source).toContain('> Item');
		expect(source).not.toContain('- Item');
	});

	test('Backspace at non-zero offset inside blockquote does character delete, not unwrap (U2 negative)', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^> Hello worl$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^> Hello worl$/m);
		expect(source).not.toMatch(/^Hello/m);
	});
});
