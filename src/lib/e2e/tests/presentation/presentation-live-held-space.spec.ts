import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, stepTo } from './helpers';
import { attachIme } from '../../simulation/ime';
import { textRunEnd } from '../../text-runs';

// A space typed at a hidden closer is written past it while the caret still means inside, so the
// next letter takes it back in. Only the source tells inside from outside, so every row reads it.
// Requirements: e2e/requirements/presentation/presentation-live-held-space.md.

async function clickEnd(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunEnd(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

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

const held = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.md-edge-held')].map((el) => el.tagName.toLowerCase())
	);

/** A line holding `a`, the caret at its end, ready to type. */
async function atLineEnd(page: Page): Promise<EditorPage> {
	const ep = await enterPresentationMode(page, 'live', 'a');
	await clickBlockSettled(ep, 0);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	return ep;
}

test.describe('live mode: a new pair keeps every word typed into it', () => {
	for (const [name, delimiter] of [
		['bold', '**'],
		['emphasis', '*'],
		['underscore emphasis', '_'],
		['strikethrough', '~~']
	]) {
		const want = `a ${delimiter}two words${delimiter}`;

		test(`${name}, typed on a hardware keyboard`, async ({ page }) => {
			const ep = await atLineEnd(page);
			await page.keyboard.type(` ${delimiter}two words`);
			await ep.bridge.waitForSourceContains(want);
		});

		test(`${name}, typed on a soft keyboard`, async ({ page }) => {
			const ep = await atLineEnd(page);
			await softType(ep, page, ` ${delimiter}two words`);
			await ep.bridge.waitForSourceContains(want);
		});
	}

	test('the space and the word committed by an IME', async ({ page }) => {
		const ep = await atLineEnd(page);
		await page.keyboard.type(' **two');
		const ime = await attachIme(page);
		await ime.compose(' ');
		await ime.commit(' ');
		await ep.waitForRenderFlush();
		await ime.compose('か');
		await ime.commit('かん');
		await ep.bridge.waitForSourceContains('a **two かん**');
	});

	test('the space and the word pasted', async ({ page }) => {
		const ep = await atLineEnd(page);
		await page.keyboard.type(' **two');
		await pasteText(ep, ' ');
		await pasteText(ep, 'words');
		await ep.bridge.waitForSourceContains('a **two words**');
	});

	test('a second space keeps the hold', async ({ page }) => {
		const ep = await atLineEnd(page);
		await page.keyboard.type(' **two  w');
		await ep.bridge.waitForSourceContains('a **two  w**');
	});
});

test.describe('live mode: typing on after an existing bold', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', 'Some **bold** text');
	});

	test('a click at its end, then a space and a word, extends it', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold more** text');
	});

	test('an arrival from outside types the space and the word outside', async ({ page }) => {
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 11);
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold** more text');
	});

	test('the format chord before the space types outside', async ({ page }) => {
		await clickEnd(ep, page, 'bold');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type(' more');
		await ep.bridge.waitForSourceContains('Some **bold** more text');
	});

	test('the ring stays on the bold over a held space, and ArrowRight takes it off', async ({
		page
	}) => {
		await clickEnd(ep, page, 'bold');
		await page.keyboard.type(' ');
		await expect.poll(() => held(page)).toEqual(['strong']);
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => held(page)).toEqual([]);
	});
});

test.describe('live mode: the hold ends without touching the bytes', () => {
	test('a click away leaves the space where it is', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'a **two**\n\nnext');
		await clickEnd(ep, page, 'two');
		await page.keyboard.type(' ');
		await clickBlockSettled(ep, 1);
		await ep.bridge.waitForSourceContains('a **two** \n\nnext');

		await clickBlockSettled(ep, 0);
		await page.keyboard.press('End');
		await page.keyboard.type('w');
		await ep.bridge.waitForSourceContains('a **two** w\n');
	});

	for (const route of ['soft keyboard', 'paste'] as const) {
		test(`after an arrow steps out of a bold, a ${route} types outside`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', 'a **bold** b');
			await clickEnd(ep, page, 'bold');
			await page.keyboard.press('ArrowRight');
			await ep.waitForRenderFlush();
			if (route === 'paste') await pasteText(ep, 'X');
			else await softType(ep, page, 'X');
			await ep.bridge.waitForSourceContains('a **bold**X b');
		});
	}

	test('source mode writes the space inside the visible closer', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', 'a **two**');
		await clickEnd(ep, page, 'two');
		await page.keyboard.type(' w');
		await ep.bridge.waitForSourceContains('a **two w**');
	});
});

/** Each way out, and what typing `w` after it writes at a line's end and mid-line. */
const EXITS: { name: string; press: (page: Page) => Promise<void>; end: string; mid: string }[] = [
	{
		name: 'one ArrowRight',
		press: (page) => page.keyboard.press('ArrowRight'),
		end: 'a **two** w',
		mid: 'Some **bold** w text'
	},
	{
		name: 'the typed closer',
		press: (page) => page.keyboard.type('*'),
		end: 'a **two** w',
		mid: 'Some **bold** w text'
	},
	{
		name: 'the format chord',
		press: (page) => page.keyboard.press('ControlOrMeta+b'),
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

test.describe('live mode: the ways out of a held space', () => {
	for (const exit of EXITS) {
		test(`${exit.name}, at a line’s end`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', 'a **two**');
			await clickEnd(ep, page, 'two');
			await page.keyboard.type(' ');
			await exit.press(page);
			await ep.waitForRenderFlush();
			await page.keyboard.type('w');
			await ep.bridge.waitForSourceContains(exit.end);
		});

		test(`${exit.name}, mid-line`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', 'Some **bold** text');
			await clickEnd(ep, page, 'bold');
			await page.keyboard.type(' ');
			await exit.press(page);
			await ep.waitForRenderFlush();
			await page.keyboard.type('w');
			await ep.bridge.waitForSourceContains(exit.mid);
		});
	}
});
