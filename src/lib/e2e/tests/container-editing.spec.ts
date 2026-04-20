/**
 * Container block editing — focuses on blockquote behavior and cross-container
 * interactions. Single-container list behavior lives in blocks/list/rendering.spec.ts.
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

test.describe('cross-container merge on Backspace (blockquote prev)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('flat blockquote: Backspace at start of following paragraph merges into inner paragraph', async () => {
		// Blank-line separator is required now that CommonMark §5.1 lazy
		// continuation is implemented — without the blank line, "text2"
		// would be absorbed into the blockquote's paragraph at parse time.
		await editor.loadContent('> text\n\ntext2\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text2$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// The outer paragraph is gone; blockquote's inner paragraph is now "texttext2"
		const source = await editor.getSource();
		expect(source).toMatch(/^> texttext2$/m);
		expect(source).not.toMatch(/^text2$/m);
	});

	test('flat blockquote: caret lands at the join point after merge', async () => {
		await editor.loadContent('> text\n\ntext2\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text2$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// Typing Z should splice into the join point: texttext2 → textZtext2
		await editor.typeText('Z');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toMatch(/^> textZtext2$/m);
	});

	test('multi-paragraph blockquote: only the last inner paragraph receives the merge', async () => {
		// Blank-line separator required to keep "text" as a separate top-level
		// paragraph after the lazy-continuation fix.
		await editor.loadContent('> first\n>\n> second\n\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^> first$/m);
		expect(source).toMatch(/^> secondtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('nested blockquote: merge recurses into deepest inner paragraph', async () => {
		await editor.loadContent('> > deep\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('> > deeptext');
		expect(source).not.toMatch(/^text$/m);
	});

	test('blockquote with heading as last inner child: merge into heading raw', async () => {
		await editor.loadContent('> # Heading\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toMatch(/^> # Headingtext$/m);
		expect(source).not.toMatch(/^text$/m);
	});

	test('blockquote with opaque deepest leaf (fenced code): fall back to move-focus', async () => {
		await editor.loadContent('> para\n>\n> ```\n> code\n> ```\ntext\n');
		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		// No merge happened — the blockquote and the following paragraph stay separate
		const source = await editor.getSource();
		expect(source).toMatch(/^> para$/m);
		expect(source).toMatch(/^text$/m);
		// The fenced code block is still there
		expect(source).toContain('```');
		expect(source).toContain('code');
	});
});

// Covers the factory mergeWithPrevious container+prose path. When an inner
// container block (blockquote or list) sits before a paragraph inside a
// BlockList, Backspace at the start of that paragraph triggers the factory's
// mergeWithPrevious with an eligible container+prose pair. The factory calls
// performMerge(trimmed prev raw + curr raw) and re-parses — the re-parser
// naturally extends the container's last prose leaf with the trailing text,
// producing the same result a walker-based approach would. This test pins
// that the concat+reparse approach merges trailing text into the deepest
// reachable prose leaf for every nested scenario exercised below.
test.describe('inner container+paragraph merge inside a blockquote', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace in trailing paragraph inside blockquote merges into deepest prose leaf of preceding nested blockquote', async () => {
		// Outer blockquote children = [paragraph "one", nested-blockquote "nested", paragraph "three"]
		await editor.loadContent('> one\n>\n> > nested\n>\n> three\n');
		const three = editor.page.locator('[contenteditable="true"]', { hasText: /^three$/ });
		await three.click();
		await editor.pressKey('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		// "three" is merged into "nested" (deepest reachable prose leaf inside the preceding nested blockquote)
		expect(source).toMatch(/nestedthree/);
		expect(source).toMatch(/^> one$/m);
		expect(source).not.toMatch(/^three$/m);
		expect(source).not.toMatch(/^> three$/m);
	});
});
