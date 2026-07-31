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
		await expect(cell).toHaveText('![alt](u)');
		await expect(cell.locator('img')).toHaveCount(0);
		await expect(cell.locator('[data-inline-widget]')).toHaveCount(0);
	});

	// The collapse is CSS, so no unit test reaches it: a single unsplit span — either arm — leaves
	// the whole source painted here, or nothing at all.
	test('image in a cell paints its alt alone in reading mode', async ({ page }) => {
		await editor.loadContent(`${HEADER}| ![alt](u) |\n`);
		const cell = page.locator('[role="cell"]').nth(1);
		const markers = cell.locator('.md-marker');
		await expect(markers).toHaveCount(2);
		await expect(markers.first()).toBeVisible();

		await page.getByTestId('presentation-toggle').click();
		await expect(markers.first()).toBeHidden();
		await expect(markers.last()).toBeHidden();
		expect(await cell.innerText()).toBe('alt');
		// Hidden, never omitted — the cell's bytes stay behind the collapse.
		await expect(cell).toHaveText('![alt](u)');
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
		// End from line 1 stays on line 1 — before the widget.
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

	// Crossing a mid-cell `<br>` with arrows is native contenteditable — the keys never reach the
	// caret-edge dispatch — so this guards only that navigation stays on an editable cell; the
	// dispatch's non-reveal step-over is pinned by the destructive-key case below.
	test('arrowing across a mid-cell <br> keeps focus on a cell, never stranding it', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight'); // past `x`
		await page.keyboard.press('ArrowRight'); // across the `<br>`

		const activeRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
		expect(activeRole).toBe('cell');
		expect(await editor.bridge.getSource()).toContain('| x<br>y | z |');
	});

	// A DESTRUCTIVE key at a `<br>` edge is the one gesture that reaches the caret-edge dispatch
	// here (arrows go native): the inherited prose select-then-delete needs a selection overlay a
	// cell never paints, so it showed nothing on press #1 and ate a non-adjacent byte on press #2.
	test('Backspace at a mid-cell <br> trailing edge deletes the whole tag in one press', async ({
		page
	}) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
		const cell = page.locator('[role="cell"]').nth(2);
		await cell.click();
		await page.keyboard.press('Control+End');
		await page.keyboard.press('ArrowLeft'); // → the <br>'s trailing edge (before `y`)

		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceContains('| xy | z |');
		// Focus survives on the cell — a prose select would have stranded it — and the
		// caret sits where the tag was, so the next char lands between x and y.
		const activeRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
		expect(activeRole).toBe('cell');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('| xZy | z |');
	});
});
