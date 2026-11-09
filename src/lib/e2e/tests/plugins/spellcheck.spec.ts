import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { textRunRect } from '../../text-runs';

/**
 * The spellcheck package (requirements/plugins/spellcheck.md) on `/test/editor?spell=on`, which
 * keeps added words, or `?spell=bare`, which keeps none: the Spelling rows over a misspelled word
 * in the right-click menu and the selection toolbar, and what a pick writes.
 */

const WAVE = '.spell-overlay';
const TEXT = 'This is a tset of speling.\n';

/** The middle of the first painted run of `word`, where a pointer lands. */
async function wordPoint(page: Page, word: string): Promise<{ x: number; y: number }> {
	const r = await textRunRect(page, word);
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function rightClickWord(page: Page, word: string): Promise<void> {
	const { x, y } = await wordPoint(page, word);
	await page.mouse.click(x, y, { button: 'right' });
}

/** The open menu's rows and dividers in order, a divider read as `|`. */
function menuEntries(page: Page): Promise<string[]> {
	return page
		.getByRole('menu')
		.locator('[role="menuitem"], [role="separator"]')
		.evaluateAll((els) =>
			els.map((el) => (el.getAttribute('role') === 'separator' ? '|' : el.textContent!.trim()))
		);
}

async function open(
	page: Page,
	query: '?spell=on' | '?spell=bare' | `?spell=on&${string}`,
	md: string,
	waves: number
) {
	const editor = new EditorPage(page);
	await editor.goto(query);
	await editor.loadContent(md);
	// A wave says the word has its answer, which is when its rows can show.
	await expect(page.locator(WAVE)).toHaveCount(waves);
	return editor;
}

test.describe('the spelling rows', () => {
	test('lead the right-click menu with a divider, and a pick rewrites one word in one undo step', async ({
		page
	}) => {
		const editor = await open(page, '?spell=on', TEXT, 2);
		await rightClickWord(page, 'tset');
		await expect(page.getByRole('menuitem').first()).toHaveText('test');
		const entries = await menuEntries(page);
		const divider = entries.indexOf('|');
		expect(entries.slice(0, divider)).toContain('Add to dictionary');
		expect(entries.indexOf('Paste')).toBeGreaterThan(divider);

		await page.getByRole('menuitem', { name: 'test', exact: true }).click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
		await editor.undo();
		await editor.bridge.waitForSourceEquals(TEXT);
	});

	test('offer Add to dictionary only where the host keeps words, and it settles the word', async ({
		page
	}) => {
		const kept = await open(page, '?spell=on', TEXT, 2);
		await rightClickWord(page, 'tset');
		await page.getByRole('menuitem', { name: 'Add to dictionary' }).click();
		await expect(page.locator(WAVE)).toHaveCount(1);
		await rightClickWord(page, 'tset');
		await expect(page.getByRole('menuitem', { name: 'test', exact: true })).toHaveCount(0);
		expect(await kept.bridge.getSource()).toBe(TEXT);

		await open(page, '?spell=bare', TEXT, 2);
		await rightClickWord(page, 'tset');
		await expect(page.getByRole('menuitem', { name: 'test', exact: true })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Add to dictionary' })).toHaveCount(0);
	});

	test('give a selection of exactly the word a Spelling row in the toolbar, whose flyout rewrites it', async ({
		page
	}) => {
		const editor = await open(page, '?spell=on', TEXT, 2);
		await editor.focusBlock(0, 10);
		for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
		const row = page.getByTestId('toolbar-action-0');
		await expect(page.getByTestId('selection-toolbar')).toBeVisible();
		await expect(row).toHaveCount(0);

		await page.keyboard.press('Shift+ArrowRight');
		await expect(row).toHaveText('Spelling');
		await row.click();
		await page
			.getByTestId('selection-toolbar')
			.getByRole('menuitem', { name: 'test', exact: true })
			.click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
	});

	test('answer the keyboard, and Escape closes them writing nothing', async ({ page }) => {
		const editor = await open(page, '?spell=on', TEXT, 2);
		await rightClickWord(page, 'tset');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(TEXT);

		await rightClickWord(page, 'tset');
		const second = await page.getByRole('menuitem').nth(1).textContent();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals(`This is a ${second!.trim()} of speling.\n`);
	});

	test('rewrite the word behind live mode’s hidden markers', async ({ page }) => {
		const editor = await open(page, '?spell=on&presentationMode=live', 'A **tset** here.\n', 1);
		await rightClickWord(page, 'tset');
		await page.getByRole('menuitem', { name: 'test', exact: true }).click();
		await editor.bridge.waitForSourceEquals('A **test** here.\n');
	});

	test('keep a CRLF document’s line endings around the word', async ({ page }) => {
		const editor = await open(page, '?spell=on', 'One tset.\r\n\r\nTwo lines.\r\n', 1);
		await rightClickWord(page, 'tset');
		await page.getByRole('menuitem', { name: 'test', exact: true }).click();
		await editor.bridge.waitForSourceEquals('One test.\r\n\r\nTwo lines.\r\n');
	});

	// A right-click in a cell opens the table's own menu, so the cell's word goes through the toolbar.
	test('rewrite a word in a table cell', async ({ page }) => {
		const md = '| a | b |\n| - | - |\n| tset | fine |\n';
		const editor = await open(page, '?spell=on', md, 1);
		await editor.focusBlockAtPath([0, 1, 0], 0);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await page.getByTestId('toolbar-action-0').click();
		await page
			.getByTestId('selection-toolbar')
			.getByRole('menuitem', { name: 'test', exact: true })
			.click();
		await editor.bridge.waitForSourceEquals('| a | b |\n| - | - |\n| test | fine |\n');
	});
});

test.describe('the waves and the hover card', () => {
	test('a misspelled word gets a wave, a right one and code none, and the browser checker is off', async ({
		page
	}) => {
		const editor = await open(page, '?spell=on', TEXT + '\n```\ntset\n```\n', 2);
		await expect(editor.getBlock(0)).toHaveAttribute('spellcheck', 'false');
	});

	test('resting the pointer on the word opens its rows alone, leaving both closes them, and a pick rewrites it', async ({
		page
	}) => {
		const editor = await open(page, '?spell=on', TEXT, 2);
		const word = await wordPoint(page, 'tset');
		const rest = async () => {
			await page.mouse.move(word.x, word.y - 40);
			await page.mouse.move(word.x, word.y);
			await expect(page.getByRole('menuitem').first()).toHaveText('test');
		};
		await rest();
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toHaveCount(0);
		await page.getByRole('menuitem').first().hover();
		await page.mouse.move(word.x, word.y + 300);
		await expect(page.getByRole('menu')).toHaveCount(0);

		await rest();
		await page.getByRole('menuitem').first().click();
		await editor.bridge.waitForSourceEquals('This is a test of speling.\n');
	});

	test('the keyboard opens the rows from the caret, and Escape closes them', async ({ page }) => {
		const editor = await open(page, '?spell=on', TEXT, 2);
		await page.evaluate(
			(command) => (window as any).__test.setKeybindings([{ chord: 'Alt+Enter', command }]),
			'decorations.activateAtCaret'
		);
		await editor.focusBlock(0, TEXT.indexOf('tset') + 2);
		await page.keyboard.press('Alt+Enter');
		await expect(page.getByRole('menuitem').first()).toHaveText('test');
		await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(TEXT);
	});

	test('the word being typed stays plain until the caret leaves it', async ({ page }) => {
		const editor = await open(page, '?spell=on', 'This is\n', 0);
		await editor.focusBlockEnd(0);
		await editor.typeText(' tset');
		await editor.bridge.waitForSourceEquals('This is tset\n');
		await editor.waitForRenderFlush();
		await expect(page.locator(WAVE)).toHaveCount(0);
		await editor.typeText(' ');
		await expect(page.locator(WAVE)).toHaveCount(1);
	});
});
