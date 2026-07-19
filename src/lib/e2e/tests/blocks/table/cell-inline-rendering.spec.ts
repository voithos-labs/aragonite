import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

const HEADER = '| H |\n| :- |\n';

test.describe('table cell: inline rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Styled inline constructs ─────────────────────────────────────────

	const STYLED_CONSTRUCTS: Array<
		[source: string, selector: string, expectedText: string, href?: string]
	> = [
		['*x*', 'em', 'x'],
		['**x**', 'strong', 'x'],
		['`x`', 'code.inline-code-content', 'x'],
		['~~x~~', 's', 'x'],
		['[t](https://example.com)', 'a.md-link-content', 't', 'https://example.com']
	];

	for (const [source, selector, expectedText, href] of STYLED_CONSTRUCTS) {
		test(`${source} in a cell renders a styled <${selector}>`, async ({ page }) => {
			await editor.loadContent(`${HEADER}| ${source} |\n`);
			const styled = page.locator('[role="cell"]').nth(1).locator(selector);
			await expect(styled).toHaveCount(1);
			await expect(styled).toHaveText(expectedText);
			if (href) await expect(styled).toHaveAttribute('href', href);
		});
	}

	// ── Reference resolution (LRD signature keying) ──────────────────────

	test('reference link in a cell resolves against an LRD', async ({ page }) => {
		await editor.loadContent(`${HEADER}| [t][r] |\n\n[r]: https://example.com\n`);
		const cell = page.locator('[role="cell"]').nth(1);
		const anchor = cell.locator('a.md-link-content');
		await expect(anchor).toHaveCount(1);
		await expect(anchor).toHaveAttribute('href', 'https://example.com');
	});

	test('editing an LRD url updates an unedited reference cell href', async ({ page }) => {
		await editor.loadContent(`${HEADER}| [t][r] |\n\n[r]: https://old.com\n`);
		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell.locator('a.md-link-content')).toHaveAttribute('href', 'https://old.com');

		// Edit only the LRD block's url in-editor (block index 1 is the LRD).
		await editor.focusBlock(1, 'https://'.length + '[r]: '.length);
		// Caret sits after "https://"; select the "old" word and retype "new".
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Shift+ArrowRight');
		await editor.typeText('new');
		await editor.bridge.waitForSourceContains('https://new.com');

		await expect(cell.locator('a.md-link-content')).toHaveAttribute('href', 'https://new.com');
	});

	// ── Escaped pipe + image + empty-cell edge cases ─────────────────────

	test('escaped pipe renders a dimmed marker and keeps textContent', async ({ page }) => {
		await editor.loadContent('| a | b \\| c |\n| --- | --- |\n');
		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell).toHaveText('b \\| c');
		await expect(cell.locator('.md-marker', { hasText: '\\' })).toHaveCount(1);
	});

	test('image in a cell stays alt-text, no widget', async ({ page }) => {
		await editor.loadContent(`${HEADER}| ![alt](u) |\n`);
		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell).toContainText('alt');
		await expect(cell.locator('img')).toHaveCount(0);
		await expect(cell.locator('[data-inline-widget]')).toHaveCount(0);
	});

	test('empty cell renders without leftover markup and stays focusable', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n|  | y |\n');
		const cell = page.locator('[role="cell"]').nth(2);
		await expect(cell).toHaveText('');
		await cell.click();
		await expect(cell).toBeFocused();
	});

	test('a cell with only a <br> widget renders the widget and nothing else', async ({ page }) => {
		await editor.loadContent(`${HEADER}| <br> |\n`);
		const cell = page.locator('[role="cell"]').nth(1);
		await expect(cell.locator('.md-br-widget')).toHaveCount(1);
		await expect(cell).toHaveText('');
	});

	// ── Widget-aware navigation (Shift+Enter itself: cell-line-break.spec.ts) ──

	test('typing after a widget appends at the correct raw offset', async ({ page }) => {
		await editor.loadContent('| H |\n| :- |\n| Left<br> |\n');
		const cell = page.locator('[role="cell"]').nth(1);
		await cell.click();
		// Ctrl+End: very end of cell content — End alone stops at the end of the
		// first visual line, before the trailing widget.
		await page.keyboard.press('Control+End');
		await editor.typeText('Z');
		// Without widget-aware offset reads, the caret read would land short of
		// the widget's 4 raw bytes and the char would splice inside the tag.
		await editor.bridge.waitForSourceContains('| Left<br>Z |');
	});

	test('typing before a trailing widget splices before its raw bytes', async ({ page }) => {
		await editor.loadContent('| H |\n| :- |\n| Left<br> |\n');
		const cell = page.locator('[role="cell"]').nth(1);
		await cell.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('End');
		await editor.typeText('Q');
		// End from line 1 stays on line 1 — before the widget. The char must
		// land before the <br> bytes, not inside or after them.
		await editor.bridge.waitForSourceContains('| LeftQ<br> |');
	});

	test('ArrowRight at the very end of a widget-bearing cell exits to the next cell', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| x<br> | y |\n');
		const first = page.locator('[role="cell"]').nth(2);
		const second = page.locator('[role="cell"]').nth(3);
		await first.click();
		await page.keyboard.press('Control+End');
		await page.keyboard.press('ArrowRight');
		await expect(second).toBeFocused();
	});

	test('Tab from a widget-bearing cell moves to the next cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| x<br> | y |\n');
		const first = page.locator('[role="cell"]').nth(2);
		const second = page.locator('[role="cell"]').nth(3);
		await first.click();
		await page.keyboard.press('Tab');
		await expect(second).toBeFocused();
	});

	// The caret-edge dispatch (threaded for inline reveal) meets a `<br>` — a
	// non-reveal widget — mid-cell. A cell has no image-overlay affordance, so the
	// dispatch steps the caret over it like native rather than selecting it; the
	// prose select path stranded focus off any cell. Navigation must stay on a cell.
	test('arrowing across a mid-cell <br> keeps focus on a cell, never stranding it', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight'); // past `x`
		await page.keyboard.press('ArrowRight'); // across the `<br>`

		// Focus stays on an editable cell (the select path dropped it to the editor
		// root); pure navigation leaves the widget's bytes untouched.
		const activeRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
		expect(activeRole).toBe('cell');
		expect(await editor.bridge.getSource()).toContain('| x<br>y | z |');
	});
});
