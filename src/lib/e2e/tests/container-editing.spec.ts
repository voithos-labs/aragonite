/**
 * Container block editing — focuses on blockquote behavior and cross-container
 * interactions. Single-container list behavior lives in blocks/list-block.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('blockquote editing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('blockquote content is editable and source keeps > prefix', async () => {
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.typeText(' again');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> .*Hello world again/m);
	});

	test('blockquote source round-trips after editing', async () => {
		await editor.loadContent('> First line\n>\n> Second line\n');
		const inner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.typeText(' appended');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('> ');
		expect(source).toContain('First line appended');
		expect(source).toContain('Second line');
	});

	test('blockquote with multiple paragraphs edits correctly', async () => {
		await editor.loadContent('> Para one\n>\n> Para two\n');
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		expect(await editables.count()).toBeGreaterThanOrEqual(2);
		await editables.nth(1).click();
		await editor.typeText(' plus');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('Para two plus');
		expect(source).toMatch(/^> /m);
	});

	test('blockquote exit via double-Enter keeps caret visible', async () => {
		// Regression: pressing Enter twice in a blockquote lost the caret.
		await editor.loadContent('> Line one.\n>\n> Line two.\n');
		const editables = editor.getBlock(0).locator('[contenteditable="true"]');
		await editables.last().click();
		await editor.pressKey('End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.typeText('After quote');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('After quote');
	});
});

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
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).not.toContain('> ');
		expect(source).toContain('Hello world');
	});

	test('multi-paragraph blockquote: Backspace at start lifts only the first paragraph', async () => {
		await editor.loadContent('> First\n>\n> Second\n');
		const firstInner = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await firstInner.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "First" should be plain paragraph (no > prefix on its line)
		expect(source).toMatch(/^First/m);
		// "Second" should still be inside a blockquote
		expect(source).toMatch(/^> Second/m);
	});

	test('nested blockquote: Backspace inside inner lifts content one level', async () => {
		await editor.loadContent('> > Deep\n');
		const deepEditable = editor.page.locator(
			'.blockquote-block .blockquote-block [contenteditable="true"]'
		);
		await deepEditable.first().click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// After one press: cursor is still inside the outer blockquote, but the
		// inner blockquote is gone. Expect one level of > prefix, not two.
		expect(source).toContain('> Deep');
		expect(source).not.toContain('> > ');
	});

	test('blockquote preceded by paragraph: no auto-merge', async () => {
		await editor.loadContent('Above paragraph.\n\n> Hello\n');
		const inner = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await inner.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		// "Above" and "Hello" should be separate paragraphs, not merged.
		expect(source).toContain('Above paragraph.');
		expect(source).toContain('Hello');
		expect(source).not.toContain('Above paragraph.Hello');
		expect(source).toMatch(/Above paragraph\.\n\s*\nHello/);
	});

	test('blockquote containing a list: Backspace at start of list item unwraps inside blockquote', async () => {
		// Cross-container: U1 (list first-item unwrap) runs against the inner
		// list while the outer blockquote stays intact.
		await editor.loadContent('> - Item\n');
		const item = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await item.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		expect(source).toContain('> Item');
		expect(source).not.toContain('- Item');
	});

	test('Backspace at non-zero offset inside blockquote does character delete, not unwrap (U2 negative)', async () => {
		// U2 must only fire at offset 0. At any other offset inside the first
		// paragraph, Backspace is a normal character delete.
		await editor.loadContent('> Hello world\n');
		const bq = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bq.click();
		await editor.pressKey('End');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// Blockquote still exists (prefix preserved), content lost one char.
		expect(source).toMatch(/^> Hello worl/m);
		expect(source).not.toMatch(/^Hello/m);
	});
});
