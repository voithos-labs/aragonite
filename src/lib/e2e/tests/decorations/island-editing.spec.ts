import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

/**
 * Decoration island editing (requirements/decorations/island-editing.md). Islands are atomic
 * widgets carrying (replace) or standing in for zero (widget) raw bytes: arrows step over
 * them, destructive keys select-then-delete a replace island whole, and a widget island is
 * transparent to Backspace — never corrupting the hidden bytes or splitting the undo entry.
 */

const ISLAND = '[data-decoration-island]';

async function addReplaceIsland(page: Page, path: number[], start: number, end: number) {
	await page.evaluate(
		({ path, start, end }) => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-replace-island',
				provide: () => [{ type: 'replace', path, start, end, class: 'e2e-island' }]
			});
		},
		{ path, start, end }
	);
}

async function addWidgetIsland(page: Page, path: number[], offset: number) {
	await page.evaluate(
		({ path, offset }) => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-widget-island',
				provide: () => [
					{
						type: 'widget',
						path,
						offset,
						widget: { buildDom: () => document.createElement('span') }
					}
				]
			});
		},
		{ path, offset }
	);
}

/** Collapse the caret immediately before/after an island element — the DOM anchor a real
 *  step-over or edge Backspace lands on, which a raw-offset text walk can't address once a
 *  replace island has removed its bytes from textContent. Setup only; the keys are real. */
async function placeCaretAtIsland(page: Page, sourceStart: number, side: 'before' | 'after') {
	await page.evaluate(
		({ sourceStart, side }) => {
			const island = document.querySelector(
				`[data-decoration-island][data-source-start='${sourceStart}']`
			);
			const block = island?.closest('[contenteditable]') as HTMLElement | null;
			if (!block || !island) throw new Error('island not rendered');
			block.focus();
			const range = document.createRange();
			if (side === 'before') range.setStartBefore(island);
			else range.setStartAfter(island);
			range.collapse(true);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
		},
		{ sourceStart, side }
	);
}

async function cursorOffset(page: Page): Promise<number | null> {
	return page.evaluate(() => (window as any).__test.getBlockCursorSurface([0]).cursorOffset);
}

test.describe('decoration island editing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('arrows step over a replace island to its far edge, never selecting it', async ({
		page
	}) => {
		await editor.loadContent('abHIDDENcd\n');
		await addReplaceIsland(page, [0], 2, 8);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 2, 'before');
		await page.keyboard.press('ArrowRight');
		expect(await cursorOffset(page)).toBe(8);

		await placeCaretAtIsland(page, 2, 'after');
		await page.keyboard.press('ArrowLeft');
		expect(await cursorOffset(page)).toBe(2);

		await expect(page.locator(`${ISLAND}.md-widget-selected`)).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe('abHIDDENcd\n');
	});

	test('Backspace against a replace island selects it whole, then deletes it in one undo', async ({
		page
	}) => {
		await editor.loadContent('abHIDDENcd\n');
		await addReplaceIsland(page, [0], 2, 8);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 2, 'after');
		await page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();
		await expect(page.locator(`${ISLAND}.md-widget-selected`)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('abHIDDENcd\n');

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('HIDDEN');
		expect(await editor.bridge.getSource()).toBe('abcd\n');

		await editor.undo();
		await editor.bridge.waitForSourceContains('HIDDEN');
		expect(await editor.bridge.getSource()).toBe('abHIDDENcd\n');
	});

	test('Delete against a replace island leading edge selects then deletes the hidden range', async ({
		page
	}) => {
		await editor.loadContent('abHIDDENcd\n');
		await addReplaceIsland(page, [0], 2, 8);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 2, 'before');
		await page.keyboard.press('Delete');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe('abHIDDENcd\n');

		await page.keyboard.press('Delete');
		await editor.bridge.waitForSourceNotContains('HIDDEN');
		expect(await editor.bridge.getSource()).toBe('abcd\n');
	});

	test('the two-press delete works on a heading island whose offsets include the marker', async ({
		page
	}) => {
		await editor.loadContent('## abHIDDEN\n');
		await addReplaceIsland(page, [0], 5, 11);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await editor.focusBlockEnd(0);
		await page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe('## abHIDDEN\n');

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('HIDDEN');
		expect(await editor.bridge.getSource()).toBe('## ab\n');
	});

	test('the two-press delete works on an ambient-prefixed list item (offsets exclude the marker)', async ({
		page
	}) => {
		await editor.loadContent('- abHIDDENcd\n');
		await addReplaceIsland(page, [0, 0, 0], 2, 8);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 2, 'after');
		await page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe('- abHIDDENcd\n');

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('HIDDEN');
		expect(await editor.bridge.getSource()).toBe('- abcd\n');
	});

	test('a widget island is transparent to Backspace, deleting the adjacent real byte', async ({
		page
	}) => {
		await editor.loadContent('hello\n');
		await addWidgetIsland(page, [0], 3);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 3, 'after');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('helo\n');
		expect(await editor.bridge.getSource()).toBe('helo\n');
	});

	test('a widget island at a block start lets Backspace fall through to block merge', async ({
		page
	}) => {
		// The island stands in for zero bytes at offset 0, so there is no adjacent
		// real byte to eat — Backspace at the block boundary must fall through to the
		// normal previous-block merge, not no-op on the island DOM.
		await editor.loadContent('alpha\n\nbeta\n');
		await addWidgetIsland(page, [1], 0);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 0, 'after');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('alphabeta\n');
		expect(await editor.bridge.getSource()).toBe('alphabeta\n');
	});

	test('typing at a widget island boundary inserts into raw at its offset', async ({ page }) => {
		await editor.loadContent('hello\n');
		await addWidgetIsland(page, [0], 3);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await placeCaretAtIsland(page, 3, 'after');
		await page.keyboard.type('z');
		await editor.bridge.waitForSourceEquals('helzlo\n');
		expect(await editor.bridge.getSource()).toBe('helzlo\n');
	});

	test('copy over a range spanning a widget island yields the byte-identical raw slice', async ({
		page
	}) => {
		await editor.loadContent('hello\n');
		await addWidgetIsland(page, [0], 3);
		await expect(page.locator(ISLAND)).toHaveCount(1);

		await editor.focusBlockStart(0);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press(`${primaryModifier}+c`);
		await editor.waitForClipboardWrite();

		const clip = await page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe('hello');
	});
});
