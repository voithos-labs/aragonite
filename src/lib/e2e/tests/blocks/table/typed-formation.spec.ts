import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import type { Page } from '@playwright/test';
import { enterPresentationMode } from '../../presentation/helpers';

// Enter at the end of a lone header row completes the table the adjacent-line grammar could never
// be typed into. The source bytes are the oracle throughout, and where the caret landed is read by
// typing a character rather than by asking for it.
// Requirements: e2e/requirements/blocks/table/typed-formation.md.

const COMPLETED = '| a | b |\n| --- | --- |\n|  |  |\n';

/** Type `row` into the empty document and press Enter at its end. */
async function typeRowAndEnter(editor: EditorPage, page: Page, row: string): Promise<void> {
	await editor.clickBlock(0);
	await page.keyboard.press('End');
	await editor.waitForRenderFlush();
	await editor.typeSlowly(row);
	await editor.bridge.waitForSourceContains(row);
	await editor.waitForRenderFlush();
	await page.keyboard.press('Enter');
}

test.describe('table block: typed formation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('\n');
	});

	test('a header row plus Enter becomes a table with a delimiter and one empty body row', async ({
		page
	}) => {
		await typeRowAndEnter(editor, page, '| a | b |');

		await editor.bridge.waitForSourceEquals(COMPLETED);
		expect(await editor.bridge.getBlockKind(0)).toBe('table');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('the caret lands in the first body cell, so the next character lands there', async ({
		page
	}) => {
		await typeRowAndEnter(editor, page, '| a | b |');
		await editor.bridge.waitForSourceEquals(COMPLETED);

		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('| a | b |\n| --- | --- |\n| Z |  |\n');
	});

	test('cell content is preserved verbatim and re-padded canonically', async ({ page }) => {
		await typeRowAndEnter(editor, page, '|a|b|');
		await editor.bridge.waitForSourceEquals(COMPLETED);
	});

	// The mint is a block replacement at the slot, so the table above must not absorb it: the
	// separating blank line is what keeps a reload seeing two tables rather than one.
	test('a table typed under an existing one keeps its own identity', async ({ page }) => {
		// Two trailing blanks, not one: the first separates and folds into trivia, the second is
		// the empty paragraph the row gets typed into.
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\n');
		await editor.clickBlock(1);
		await page.keyboard.press('End');
		await editor.waitForRenderFlush();
		await editor.typeSlowly('| a | b |');
		await editor.bridge.waitForSourceContains('| a | b |');
		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceEquals(
			'| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| a | b |\n| --- | --- |\n|  |  |\n'
		);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('table');
	});

	test('one undo restores the paragraph byte-for-byte with the caret at its end', async ({
		page
	}) => {
		await typeRowAndEnter(editor, page, '| a | b |');
		await editor.bridge.waitForSourceEquals(COMPLETED);

		await editor.undo();
		await editor.bridge.waitForSourceEquals('| a | b |\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');

		// The undo snapshot anchors where the caret WAS, not where the mint sent it.
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('| a | b |Z\n');
	});

	// Intended, and documented: the restored line is still a claimable header row.
	test('Enter again after the undo completes again', async ({ page }) => {
		await typeRowAndEnter(editor, page, '| a | b |');
		await editor.bridge.waitForSourceEquals(COMPLETED);

		await editor.undo();
		await editor.bridge.waitForSourceEquals('| a | b |\n');

		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals(COMPLETED);
	});

	// Both rows leave the shape any tail-block split leaves (`plain\n` + Enter is byte-identical),
	// so the pair pins "the completion did not fire" rather than a shape of its own.
	test.describe('rows the completion declines', () => {
		test('a single-cell row falls through to the ordinary split', async ({ page }) => {
			await typeRowAndEnter(editor, page, '|a|');

			await editor.bridge.waitForBlockCount(2);
			await editor.bridge.waitForSourceEquals('|a|\n\n\n');
			expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		});

		// The parser's scan WOULD take `a | b` as a two-cell header; the leading pipe is the
		// intent gate, so prose carrying a pipe splits like any other paragraph.
		test('a row without a leading pipe falls through to the ordinary split', async ({ page }) => {
			await typeRowAndEnter(editor, page, 'a | b');

			await editor.bridge.waitForBlockCount(2);
			await editor.bridge.waitForSourceEquals('a | b\n\n\n');
			expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		});
	});

	// The container scope resolves the caret through its OWN ref array, so the landing is a
	// different code path from the top-level one every case above rides.
	test('a row typed inside a blockquote completes and lands the caret in its body cell', async ({
		page
	}) => {
		await editor.loadContent('> \n');
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.waitForRenderFlush();
		await editor.typeSlowly('| a | b |');
		await editor.bridge.waitForSourceContains('> | a | b |');
		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceEquals('> | a | b |\n> | --- | --- |\n> |  |  |\n');
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('> | a | b |\n> | --- | --- |\n> | Z |  |\n');
	});

	test('an escaped pipe stays cell content, so the row completes with two columns', async ({
		page
	}) => {
		await typeRowAndEnter(editor, page, '| a \\| x | b |');

		await editor.bridge.waitForSourceEquals('| a \\| x | b |\n| --- | --- |\n|  |  |\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('table');
	});
});

test.describe('table block: typed formation across presentation modes', () => {
	// The grid paints in every mode, so the minted caret target is a real cell — G1.33 rides the
	// shared fixture's console watch, and a typed byte is what arms it.
	test('live mode mints the same table and lands the typed byte in a body cell', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', '\n');
		await ep.clickBlock(0);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await ep.typeSlowly('| a | b |');
		await ep.bridge.waitForSourceContains('| a | b |');
		await ep.waitForRenderFlush();
		await page.keyboard.press('Enter');

		await ep.bridge.waitForSourceEquals(COMPLETED);
		expect(await ep.bridge.getBlockKind(0)).toBe('table');

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceEquals('| a | b |\n| --- | --- |\n| Z |  |\n');
	});

	test('reading mode leaves the bytes alone', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'reading', '| a | b |\n');
		await ep.clickBlock(0);
		await page.keyboard.press('Enter');
		await ep.waitForRenderFlush();

		await ep.bridge.waitForSourceEquals('| a | b |\n');
		expect(await ep.bridge.getBlockKind(0)).toBe('paragraph');
	});
});
