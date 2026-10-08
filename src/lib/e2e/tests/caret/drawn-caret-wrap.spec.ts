import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { oneCaretOnTheBrowsersLine } from '../../carets-showing';
import { textRunRect } from '../../text-runs';

// The drawn caret where a line soft-wraps (requirements/caret/drawn-caret-wrap.md). The range at
// the offset a line wraps reads the first line's end, whichever line the browser draws on, so
// there the drawn caret steps aside; every row shows exactly one caret, and a drawn one is
// compared against the browser's own painted caret.

test.describe('the drawn caret at a soft wrap', () => {
	let editor: EditorPage;
	const LONG = 'wrap '.repeat(60).trim();

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(`${LONG}\n`);
	});

	test('End on a wrapped line: the browser’s own caret, at the wrap', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
	});

	test('Home on the second visual line: the browser’s own caret, at the wrap', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Home');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
	});

	test('ArrowRight across a wrap: the drawn caret, on the browser’s line', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});

	test('typing at a wrap: one caret, on the browser’s line', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		await page.keyboard.type('x');
		await oneCaretOnTheBrowsersLine(page);
	});
});

// ── A visual line that starts with a formatted word ────────────────────────

const FORMATS: Array<[string, (word: string) => string]> = [
	['a bold word', (word) => `**${word}**`],
	['a code span', (word) => '`' + word + '`'],
	['a link', (word) => `[${word}](https://example.com)`]
];

/** How many `wrap ` words fill the block's first visual line. */
async function wordsOnFirstLine(page: Page): Promise<number> {
	return page.evaluate(() => {
		const el = document.querySelector<HTMLElement>('.editor [contenteditable="true"]')!;
		const text = el.firstChild as Text;
		const top = (at: number) => {
			const r = document.createRange();
			r.setStart(text, at);
			r.setEnd(text, at + 1);
			return r.getClientRects()[0].top;
		};
		let words = 0;
		while (top(words * 5) === top(0)) words++;
		return words;
	});
}

/** Where to click inside `fmtword`, and whether the word starts a later visual line. */
async function formattedWord(page: Page): Promise<{ x: number; y: number; wrapped: boolean }> {
	const word = await textRunRect(page, 'fmtword', { path: [0] });
	const block = (await page.locator('.editor [contenteditable="true"]').first().boundingBox())!;
	return {
		x: word.left + word.width / 2,
		y: word.top + word.height / 2,
		wrapped: word.top > block.y + 10
	};
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: Home on a visual line that starts with a formatted word`, () => {
		for (const [what, wrap] of FORMATS) {
			test(`${what}: the browser’s own caret, at the wrap`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
				await editor.loadContent(`${'wrap '.repeat(60).trim()}\n`);
				const fits = await wordsOnFirstLine(page);
				let point = { x: 0, y: 0, wrapped: false };
				for (const words of [fits, fits - 1, fits + 1]) {
					await editor.loadContent(`${'wrap '.repeat(words)}${wrap('fmtword')} tail\n`);
					point = await formattedWord(page);
					if (point.wrapped) break;
				}
				expect(point.wrapped, 'the formatted word starts the second visual line').toBe(true);
				await page.mouse.click(point.x, point.y);
				await page.keyboard.press('Home');
				expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
			});
		}
	});
}
