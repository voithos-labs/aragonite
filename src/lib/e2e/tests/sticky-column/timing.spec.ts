/**
 * Sticky column — rapid cross-block navigation timing (isAtFirstVisualLine / isAtLastVisualLine).
 * See e2e/requirements/sticky-column.md.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('sticky column: rapid cross-block navigation (timing)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Tests that consecutive vertical-arrow presses without any settling time
	// still cross block boundaries correctly. A bug in isAtFirstVisualLine /
	// isAtLastVisualLine causes the handler to miss the "at boundary" signal
	// under rapid input when the block's firstChild/lastChild is a non-text
	// node (headings have a marker span as firstChild; inline markup blocks
	// have markup spans at one or both ends). When the check returns false
	// incorrectly, the browser's native ArrowUp/ArrowDown runs, which for
	// single-line blocks moves the cursor to offset 0 / textLen of the SAME
	// block instead of crossing the boundary.
	//
	// Assertion strategy: type a marker character after rapid navigation,
	// then check which line of the source contains the marker. If the
	// cursor didn't cross as many blocks as it should have, the marker
	// lands in the wrong line.

	test('rapid ArrowUp across headings crosses to the first heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await h3.click();
		await editor.page.keyboard.press('End');

		// Two consecutive presses with no settling time — should cross H3→H2→H1
		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		// After 2 Ups from H3, cursor should be somewhere in H1 (line 0)
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across headings crosses to the last heading', async () => {
		await editor.loadContent('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
		const h1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await h1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		// Lines: ['# Heading 1', '', '## Heading 2', '', '### Heading 3', '']
		// After 2 Downs from H1, cursor should be in H3 (line 4)
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across plain paragraphs crosses to the first', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across plain paragraphs crosses to the last', async () => {
		await editor.loadContent('Para one.\n\nPara two.\n\nPara three.\n');
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});

	test('rapid ArrowUp across paragraphs whose first child is a markup span', async () => {
		// DOM: firstChild is the dimmed `**` marker span (non-text).
		// This should exercise the same isAtFirstVisualLine fragile path as headings.
		await editor.loadContent(
			'**bold one** rest of para.\n\n**bold two** rest of para.\n\n**bold three** rest of para.\n'
		);
		const p3 = editor.page.locator('[contenteditable="true"]').nth(2);
		await p3.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowUp();
		await editor.pressArrowUp();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[0]).toContain('X');
	});

	test('rapid ArrowDown across paragraphs whose last child is a markup span', async () => {
		// DOM: lastChild is the dimmed `**` marker span (non-text).
		// This should exercise the isAtLastVisualLine fragile path.
		await editor.loadContent(
			'rest of para **bold one**\n\nrest of para **bold two**\n\nrest of para **bold three**\n'
		);
		const p1 = editor.page.locator('[contenteditable="true"]').nth(0);
		await p1.click();
		await editor.page.keyboard.press('End');

		await editor.pressArrowDown();
		await editor.pressArrowDown();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);

		const source = await editor.getSource();
		const lines = source.split('\n');
		expect(lines[4]).toContain('X');
	});
});
