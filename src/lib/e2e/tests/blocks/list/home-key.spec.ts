import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../../editor-page';
import {
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	landAt
} from '../../presentation/helpers';

// Home in a list item goes to the start of the caret's own line, and only the first line stops
// after the marker. Requirements: `e2e/requirements/blocks/list/home-key.md`.

const BROKEN = '- abc def\\\n  e.g.\n';
// The item's text is `abc def\` + newline + `e.g.`: the second line starts at 9 and ends at 13.
const SECOND_LINE = 9;
const WRAPPING = `- ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}\n`;

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');
const anchorOffset = async (ep: EditorPage) =>
	(await ep.bridge.getSelectionPaths())?.anchor.offset ?? -1;
const caretTop = (page: Page) =>
	page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top);

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode}: Home in a list item`, () => {
		test('on the line after a hard break lands at that line, and Backspace keeps the item', async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, BROKEN);
			await clickWordSettled(ep, page, 'e.g.');

			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();
			expect(await focusOffset(ep)).toBe(SECOND_LINE);

			await page.keyboard.press('Backspace');
			await ep.waitForRenderFlush();
			expect(await ep.bridge.getSource()).toMatch(/^- abc def/);
		});

		test('on a wrapped line lands at that line', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, WRAPPING);
			await clickWordSettled(ep, page, 'word39');
			const top = await caretTop(page);

			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();
			const offset = await focusOffset(ep);
			expect(offset).toBeGreaterThan(0);
			expect(await caretTop(page)).toBe(top);
			expect(WRAPPING.slice(2)[offset - 1]).toBe(' ');
		});

		test('Shift+Home on the line after a hard break selects that line', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, BROKEN);
			await clickWordSettled(ep, page, 'e.g.');
			await page.keyboard.press('End');

			await page.keyboard.press('Shift+Home');
			await ep.waitForRenderFlush();
			expect(await anchorOffset(ep)).toBe(13);
			expect(await focusOffset(ep)).toBe(SECOND_LINE);
			expect(await selectedText(page)).toBe('e.g.');
		});

		test('on the first line still stops after the marker', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, BROKEN);
			await clickWordSettled(ep, page, 'def');

			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();
			expect(await focusOffset(ep)).toBe(0);
			await ep.typeText('X');
			await ep.bridge.waitForSourceEquals('- Xabc def\\\n  e.g.\n');
		});

		test('Shift+Home on the first line selects from the text start, not the marker', async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, BROKEN);
			await clickWordSettled(ep, page, 'def');
			await landAt(ep, page, 5);

			await page.keyboard.press('Shift+Home');
			await ep.waitForRenderFlush();
			expect(await anchorOffset(ep)).toBe(5);
			expect(await focusOffset(ep)).toBe(0);
			expect(await selectedText(page)).toBe('abc d');
		});
	});
}
