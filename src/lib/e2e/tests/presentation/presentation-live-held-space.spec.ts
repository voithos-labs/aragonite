import { test, expect } from '../../fixtures';
import { drawnCaretMarks } from '../../carets-showing';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, clickEnd, enterPresentationMode, nextRow, stepTo } from './helpers';
import { attachIme } from '../../simulation/ime';

// A space typed at a hidden closer is written past it while the caret still means inside, so the
// next letter takes it back in. Only the source tells inside from outside, so every row reads it.
// Each test walks its rows as steps, every step on a fresh copy of the document.
// Requirements: e2e/requirements/presentation/presentation-live-held-space.md.

/** `text` on a soft keyboard: each character arrives on `beforeinput`, no key behind it. */
async function softType(ep: EditorPage, page: Page, text: string): Promise<void> {
	for (const ch of text) {
		await page.keyboard.insertText(ch);
		await ep.waitForRenderFlush();
	}
}

async function pasteText(ep: EditorPage, text: string): Promise<void> {
	await ep.seedClipboard(text);
	await ep.paste();
	await ep.waitForRenderFlush();
}

/** A fresh line holding `a`, the caret at its end, ready to type. */
async function atLineEnd(ep: EditorPage, page: Page): Promise<void> {
	await nextRow(ep, 'a');
	await clickBlockSettled(ep, 0);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
}

const DELIMITERS = [
	['bold', '**'],
	['emphasis', '*'],
	['underscore emphasis', '_'],
	['strikethrough', '~~']
] as const;

test.describe('live mode: a new pair keeps every word typed into it', () => {
	test('typed on a hardware keyboard', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a');

		for (const [name, delimiter] of DELIMITERS) {
			await test.step(name, async () => {
				await atLineEnd(ep, page);
				await page.keyboard.type(` ${delimiter}two words`);
				await ep.bridge.waitForSourceContains(`a ${delimiter}two words${delimiter}`);
			});
		}

		await test.step('a second space keeps the hold', async () => {
			await atLineEnd(ep, page);
			await page.keyboard.type(' **two  w');
			await ep.bridge.waitForSourceContains('a **two  w**');
		});
	});

	test('typed on a soft keyboard', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a');

		for (const [name, delimiter] of DELIMITERS) {
			await test.step(name, async () => {
				await atLineEnd(ep, page);
				await softType(ep, page, ` ${delimiter}two words`);
				await ep.bridge.waitForSourceContains(`a ${delimiter}two words${delimiter}`);
			});
		}
	});

	test('the space and the word committed by an IME, then pasted', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a');

		await test.step('committed by an IME', async () => {
			await atLineEnd(ep, page);
			await page.keyboard.type(' **two');
			const ime = await attachIme(page);
			await ime.compose(' ');
			await ime.commit(' ');
			await ep.waitForRenderFlush();
			await ime.compose('か');
			await ime.commit('かん');
			await ep.bridge.waitForSourceContains('a **two かん**');
		});

		await test.step('pasted', async () => {
			await atLineEnd(ep, page);
			await page.keyboard.type(' **two');
			await pasteText(ep, ' ');
			// Read before the word, which would pull a space written inside back in either way.
			await ep.bridge.waitForSourceContains('a **two** ');
			await pasteText(ep, 'words');
			await ep.bridge.waitForSourceContains('a **two words**');
		});
	});
});

test('live mode: typing on after an existing bold', async ({ page }) => {
	const DOC = 'Some **bold** text';
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('a click at its end, then a space and a word, extends it', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'bold');
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold more** text');
	});

	// The character before the caret is bold, whichever way the caret got there.
	await test.step('an arrow back from the text after it, then a space and a word, extends it', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 11);
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold more** text');
	});

	await test.step('the format chord before the space types outside', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'bold');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold** more text');
	});

	await test.step('the caret keeps the bold shape over a held space, and ArrowRight turns it plain', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'bold');
		await page.keyboard.type(' ');
		await expect.poll(() => drawnCaretMarks(page)).toEqual(['strong']);
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => drawnCaretMarks(page)).toEqual([]);
	});
});

test('live mode: a format chord during a held space', async ({ page }) => {
	const DOC = 'a **two**';
	const ep = await enterPresentationMode(page, 'live', DOC);

	for (const [chord, want] of [
		['i', 'a **two** *x*'],
		['b', 'a **two** x']
	] as const) {
		await test.step(`Mod+${chord.toUpperCase()} after a held space in a bold types ${want}`, async () => {
			await nextRow(ep, DOC);
			await clickEnd(ep, page, 'two');
			await page.keyboard.type(' ');
			await page.keyboard.press(`ControlOrMeta+${chord}`);
			await ep.waitForRenderFlush();
			await page.keyboard.type('x');
			await ep.bridge.waitForSourceContains(want);
		});
	}
});

test('live mode: the hold ends without touching the bytes', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', '\n');

	await test.step('a click away leaves the space where it is', async () => {
		await nextRow(ep, 'a **two**\n\nnext');
		await clickEnd(ep, page, 'two');
		await page.keyboard.type(' ');
		await clickBlockSettled(ep, 1);
		await ep.bridge.waitForSourceContains('a **two** \n\nnext');

		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await page.keyboard.type('w');
		await ep.bridge.waitForSourceContains('a **two** w\n');
	});

	await test.step('after a typed closer steps out of a bold, a paste types outside', async () => {
		await nextRow(ep, 'a **bold** b');
		await clickEnd(ep, page, 'bold');
		await page.keyboard.type('**');
		await ep.waitForRenderFlush();
		await pasteText(ep, 'X');
		await ep.bridge.waitForSourceContains('a **bold**X b');
	});
});

/** Each way out, and what typing `w` after it writes at a line's end and mid-line. */
const EXITS: { name: string; press: (page: Page) => Promise<void>; end: string; mid: string }[] = [
	{
		name: 'the typed closer',
		press: (page) => page.keyboard.type('*'),
		end: 'a **two** w',
		mid: 'Some **bold** w text'
	},
	{
		name: 'End',
		press: (page) => page.keyboard.press('End'),
		end: 'a **two** w',
		mid: 'Some **bold**  textw'
	}
];

test('live mode: the ways out of a held space', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', '\n');

	for (const exit of EXITS) {
		for (const [where, doc, word, written] of [
			['at a line’s end', 'a **two**', 'two', exit.end],
			['mid-line', 'Some **bold** text', 'bold', exit.mid]
		] as const) {
			await test.step(`${exit.name}, ${where}`, async () => {
				await nextRow(ep, doc);
				await clickEnd(ep, page, word);
				await page.keyboard.type(' ');
				await exit.press(page);
				await ep.waitForRenderFlush();
				await page.keyboard.type('w');
				await ep.bridge.waitForSourceContains(written);
			});
		}
	}
});
