import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
const replaceInput = (page: Page) => page.getByRole('textbox', { name: 'Replace' });
const count = (page: Page) => page.locator('.search-count');
const overlays = (page: Page) => page.locator('.match-overlay');
const activeOverlays = (page: Page) => page.locator('.match-overlay-active');

// Ctrl+F / Ctrl+H route through a document-level handler, so the editor only
// needs focus somewhere on the page. Click block 0 first, then open; the bar
// auto-focuses the find input, so typing lands there.
async function openFind(editor: EditorPage) {
	await editor.clickBlock(0);
	await editor.page.keyboard.press(`${primaryModifier}+f`);
	await findInput(editor.page).waitFor({ state: 'visible' });
}

async function openReplace(editor: EditorPage) {
	await editor.clickBlock(0);
	await editor.page.keyboard.press(`${primaryModifier}+h`);
	await replaceInput(editor.page).waitFor({ state: 'visible' });
}

// Type into the (already-focused) find input character by character.
async function typeQuery(editor: EditorPage, query: string) {
	await editor.page.keyboard.type(query);
}

test.describe('search — open and close', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha beta\n\ngamma alpha\n');
	});

	test('Ctrl+F opens the bar and focuses the find input', async ({ page }) => {
		await openFind(editor);
		await expect(findInput(page)).toBeFocused();
	});

	test('Ctrl+H opens the bar with the replace row expanded', async ({ page }) => {
		await openReplace(editor);
		await expect(replaceInput(page)).toBeVisible();
	});

	// CapsLock uppercases e.key without a Shift modifier; pressing an uppercase
	// letter reproduces exactly that event shape.
	test('Ctrl+F and Ctrl+H still open with CapsLock on', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press(`${primaryModifier}+F`);
		await expect(findInput(page)).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);

		await page.keyboard.press(`${primaryModifier}+H`);
		await expect(replaceInput(page)).toBeVisible();
	});

	test('Esc closes the bar, clears highlights, and returns focus to the document', async ({
		page
	}) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);
		await expect(overlays(page)).toHaveCount(0);
		// Focus returns to the document (the editor root), not stranded on <body>.
		await expect
			.poll(() => page.evaluate(() => !!document.activeElement?.closest('.editor')))
			.toBe(true);
	});

	test('reopening after Esc with an unchanged query re-paints the highlights', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.keyboard.press('Escape');
		await expect(overlays(page)).toHaveCount(0);

		// Reopen with no edits between: the retained query must re-scan and re-paint,
		// not serve the closed bar's cleared match set through a stale scan memo.
		await openFind(editor);
		await expect(overlays(page)).toHaveCount(2);
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});
});

test.describe('search — find and highlight', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha beta\n\ngamma alpha\n\nalpha delta\n');
	});

	test('typing a query paints one overlay per match and reads 1 / N', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(3);
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
		await expect(activeOverlays(page)).toHaveCount(1);
	});

	test('a query with no matches reads No results and paints nothing', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'zzzznotpresent');
		await expect(count(page)).toHaveText(/No results/);
		await expect(overlays(page)).toHaveCount(0);
	});

	test('a regex matching empty paints no zero-width overlay sliver', async ({ page }) => {
		await openFind(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		// `a*` matches each `a` run AND the empty string at every other position; the
		// empty matches measure zero-width and must be dropped, not painted.
		await typeQuery(editor, 'a*');
		await expect(overlays(page).first()).toBeVisible();
		const widths = await overlays(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().width)
		);
		expect(widths.length).toBeGreaterThan(0);
		expect(widths.every((w) => w > 0)).toBe(true);
	});
});

test.describe('search — navigation', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha one\n\nalpha two\n\nalpha three\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
	});

	test('Enter advances to the next match and wraps at the end', async ({ page }) => {
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/3\s*\/\s*3/);
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
	});

	test('Shift+Enter steps to the previous match and wraps at the start', async ({ page }) => {
		await page.keyboard.press('Shift+Enter');
		await expect(count(page)).toHaveText(/3\s*\/\s*3/);
		await page.keyboard.press('Shift+Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
	});

	test('exactly one overlay is active after navigating', async ({ page }) => {
		await page.keyboard.press('Enter');
		await expect(count(page)).toHaveText(/2\s*\/\s*3/);
		await expect(activeOverlays(page)).toHaveCount(1);
	});
});

test.describe('search — toggles', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('case toggle narrows the match set to the case-sensitive subset', async ({ page }) => {
		await editor.loadContent('Alpha and alpha and ALPHA\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);

		await page.getByRole('button', { name: 'Match case' }).click();
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
	});

	test('whole-word toggle drops substring-only matches', async ({ page }) => {
		await editor.loadContent('cat catalog scatter cat\n');
		await openFind(editor);
		await typeQuery(editor, 'cat');
		await expect(count(page)).toHaveText(/1\s*\/\s*4/);

		await page.getByRole('button', { name: 'Whole word' }).click();
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});

	test('regex toggle interprets the query as a pattern', async ({ page }) => {
		await editor.loadContent('a1 b2 c3 plain\n');
		await openFind(editor);
		await typeQuery(editor, '[a-c][0-9]');
		// As a literal, the bracket query matches nothing.
		await expect(count(page)).toHaveText(/No results/);

		await page.getByRole('button', { name: 'Regex' }).click();
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);
	});

	test('invalid regex shows an error state with no count and no highlights', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));

		await editor.loadContent('some text here\n');
		await openFind(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		// Clicking the toggle moved focus off the find input; refocus before typing.
		await findInput(page).click();
		await typeQuery(editor, '(');

		// Positively assert the error state (the readout carries the `error` class and
		// the compiler's message), not merely the absence of a count.
		await expect(count(page)).toHaveClass(/error/);
		await expect(count(page)).not.toHaveText(/\d+\s*\/\s*\d+/);
		await expect(count(page)).not.toHaveText(/No results/);
		await expect(overlays(page)).toHaveCount(0);
		expect(pageErrors).toEqual([]);
	});
});

test.describe('search — replace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Replace rewrites the active match, advances, and leaves the rest', async ({ page }) => {
		await editor.loadContent('foo one\n\nfoo two\n\nfoo three\n');
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'foo');
		await replaceInput(page).fill('bar');
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('bar one');

		const source = await editor.bridge.getSource();
		expect(source).toContain('bar one');
		expect(source).toContain('foo two');
		expect(source).toContain('foo three');
		// One match consumed; two remain.
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});

	test('Replace All rewrites every match in one undo step', async ({ page }) => {
		await editor.loadContent('foo one\n\nfoo two\n\nfoo three\n');
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'foo');
		await replaceInput(page).fill('bar');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceNotContains('foo');

		const replaced = await editor.bridge.getSource();
		expect(replaced).not.toContain('foo');
		expect(replaced).toContain('bar one');
		expect(replaced).toContain('bar two');
		expect(replaced).toContain('bar three');

		// A SINGLE undo restores the entire original document. Clicking "All" left
		// focus on the button; Ctrl+Z only routes through a focused block (or the
		// editor root), so focus a block first.
		await editor.clickBlock(0);
		await editor.undo();
		await editor.bridge.waitForSourceContains('foo three');
		const reverted = await editor.bridge.getSource();
		expect(reverted).toContain('foo one');
		expect(reverted).toContain('foo two');
		expect(reverted).toContain('foo three');
		expect(reverted).not.toContain('bar');
	});

	test('a regex $1 capture reference expands in the replacement', async ({ page }) => {
		await editor.loadContent('2026-06-21 and 1999-12-31\n');
		await openReplace(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, '(\\d{4})-(\\d{2})-(\\d{2})');
		await replaceInput(page).fill('$3/$2/$1');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('21/06/2026');
		const source = await editor.bridge.getSource();
		expect(source).toContain('21/06/2026');
		expect(source).toContain('31/12/1999');
	});
});

test.describe('search — structural replace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a replacement introducing a heading marker changes the block kind', async ({ page }) => {
		await editor.loadContent('TITLE here\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');

		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'TITLE');
		await replaceInput(page).fill('# Heading');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('# Heading');
		await page.waitForFunction(() => (window as any).__test.getBlockKind(0) === 'heading', null, {
			timeout: 2000,
			polling: 16
		});
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	test('a replacement containing a newline splits the block in two', async ({ page }) => {
		await editor.loadContent('left SPLIT right\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);

		await openReplace(editor);
		// A single-line replace input can't carry a real newline; in regex mode a
		// literal `\n` escape expands to one (matching VS Code's regex replace).
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, 'SPLIT');
		await replaceInput(page).fill('one\\n\\ntwo');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		const source = await editor.bridge.getSource();
		expect(source).toContain('left one');
		expect(source).toContain('two right');
	});
});

test.describe('search — tables', () => {
	let editor: EditorPage;
	// A normal small table: header + delimiter + three body rows, all mounted.
	const TABLE =
		'| Name | Role |\n' +
		'| :--- | :--- |\n' +
		'| Ada | dev |\n' +
		'| Grace | dev |\n' +
		'| Linus | lead |\n';

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('find counts and highlights matches inside table cells', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'dev');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
		// The table's BlockHost paints one whole-cell overlay per matching cell
		// (positioned over the cell via cellRect, not nested inside [role=cell]).
		await expect(overlays(page)).toHaveCount(2);
		await expect(overlays(page).first()).toBeVisible();
	});

	test('Replace All rewrites text in every matching cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceNotContains('| dev |');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('| dev |');
		expect(source).toContain('engineer');
		expect(source.match(/engineer/g)?.length).toBe(2);
		// The table structure survives — still one table block.
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('single Replace on a cell match rewrites only that cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('engineer');
		const source = await editor.bridge.getSource();
		// Exactly one cell changed; the other still reads dev.
		expect(source.match(/engineer/g)?.length).toBe(1);
		expect(source).toContain('| dev |');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
	});
});

test.describe('search — edit while open', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('editing the document while the bar is open re-scans the count', async ({ page }) => {
		await editor.loadContent('alpha beta\n');
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);

		// Real edit: focus the block and type another occurrence. The bar's
		// open-state rescan should pick it up.
		await editor.focusBlockEnd(0);
		await editor.typeText(' alpha');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});
});

test.describe('search — bar stays pinned', () => {
	// Regression: the bar was absolutely positioned inside the scroll container, so
	// navigating to an off-screen match scrolled it out of view. A zero-height
	// sticky anchor now pins it to the scrollport top.
	test('the bar remains in the editor viewport after Next scrolls to an off-screen match', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		// Needle at the top and far below; filler between forces a scroll when
		// navigating from the first match to the second.
		const filler = Array.from({ length: 80 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`needle top\n\n${filler}\n\nneedle bottom\n`);

		await openFind(editor);
		await typeQuery(editor, 'needle');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		const barPlacement = () =>
			page.evaluate(() => {
				const ed = document.querySelector('.editor')!.getBoundingClientRect();
				const bar = document.querySelector('.search-bar')?.getBoundingClientRect();
				if (!bar) return null;
				return {
					pinnedToTop: bar.top >= ed.top - 2,
					inViewport: bar.bottom > ed.top && bar.top < ed.bottom,
					barTop: Math.round(bar.top),
					edTop: Math.round(ed.top)
				};
			});

		const before = await barPlacement();
		expect(before, 'search bar must exist').not.toBeNull();
		expect(before!.pinnedToTop && before!.inViewport).toBe(true);

		// Navigate to the off-screen match; the editor scrolls down to reveal it.
		await page.getByRole('button', { name: 'Next match' }).click();
		await expect(count(page)).toHaveText(/2\s*\/\s*2/);
		// Guard against a vacuous pass: if a future viewport change stops the doc
		// from overflowing, Next scrolls nothing and "bar stayed at top" is trivially
		// true. Assert the reveal actually scrolled the editor.
		await expect
			.poll(() => page.evaluate(() => document.querySelector('.editor')!.scrollTop))
			.toBeGreaterThan(0);
		await expect.poll(async () => (await barPlacement())?.inViewport).toBe(true);

		const after = await barPlacement();
		expect(
			after!.pinnedToTop,
			`bar.top=${after!.barTop} drifted from editor.top=${after!.edTop} — it scrolled away`
		).toBe(true);
	});
});

test.describe('search — off-window reveal', () => {
	test('navigating to an off-window match scrolls its block into view', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));

		const editor = new EditorPage(page);
		await editor.goto();
		// A multi-MB fixture activates windowing; the suffix appends a paragraph
		// holding a unique marker as the LAST (off-window) block. The fixture's
		// 16-word vocabulary never contains the marker, so it is the sole match.
		await editor.loadLargeFixture('many-small-blocks', 2_000_000, '\n\nZZUNIQUEMARKER tail\n');

		const blockCount = await page.evaluate(
			() => (window as any).__test.getDocument().children.length
		);
		const last = blockCount - 1;

		// Precondition: windowing is active and the marker block is genuinely
		// off-window, or the reveal assertion is vacuous.
		expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
		expect(
			await page.evaluate(
				(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
				last
			)
		).toBe(false);

		await openFind(editor);
		await page.keyboard.type('ZZUNIQUEMARKER');
		await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*1/);

		// Enter navigates to the (only) match and reveals it.
		await page.keyboard.press('Enter');
		await page.waitForFunction(
			(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
			last,
			{ timeout: 10_000, polling: 16 }
		);
		expect(
			await page.evaluate(
				(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
				last
			)
		).toBe(true);
		expect(pageErrors).toEqual([]);
	});
});
