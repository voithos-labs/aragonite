import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	landAt,
	stepTo
} from './helpers';

// Typing a construct closed and leaving it in live mode: the auto-pair arm and the typing seat
// as one gesture. The source is the oracle throughout.
// Requirements: e2e/requirements/presentation/presentation-live-delimiter-gestures.md.

const DOC = [
	'Some *em* text',
	'',
	'Some **strong** text',
	'',
	'Some `code` text',
	'',
	'Some ~~strike~~ text',
	'',
	'Some **bold *nested* bold** text',
	'',
	'plain tail'
].join('\n');

const STRONG = 1;
const PLAIN = 5;

/** word, content end, closer, and the source after the closer steps over and `X` lands. */
const PAIRS = [
	['em', 8, '*', 'Some *em*X text'],
	['strong', 13, '**', 'Some **strong**X text'],
	['code', 10, '`', 'Some `code`X text'],
	['strike', 13, '~~', 'Some ~~strike~~X text'],
	['nested', 19, '*', 'Some **bold *nested*X bold** text']
] as const;

const enterLive = (page: Page) => enterPresentationMode(page, 'live', DOC);

async function atEnd(ep: EditorPage, page: Page, block: number, target: number): Promise<void> {
	await clickBlockSettled(ep, block);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	await stepTo(ep, page, 'ArrowLeft', target);
}

test.describe('live mode — the closer typed over a hidden closer steps past it', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	for (const [word, contentEnd, closer, after] of PAIRS) {
		test(`${word}: the next byte lands after the construct`, async ({ page }) => {
			await clickWordSettled(ep, page, word);
			await landAt(ep, page, contentEnd);
			await page.keyboard.type(closer);
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(after);
		});
	}

	test('arrived from outside, the press steps past it all the same', async ({ page }) => {
		await atEnd(ep, page, STRONG, 13);
		await page.keyboard.type('**X');
		await ep.bridge.waitForSourceContains('Some **strong**X text');
	});

	// The keydown seat owns WHERE a byte lands at a hidden edge; the pair is still the arm's.
	test('a delimiter typed at the trailing edge from outside lands its twin past the closer', async ({
		page
	}) => {
		await atEnd(ep, page, STRONG, 13);
		await page.keyboard.type('`');
		await ep.bridge.waitForSourceContains('Some **strong**`` text');
	});
});

test.describe('live mode — a construct typed to completion is left behind', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
	});

	// `tail*` pairs nothing (an opener straight after a word byte), so the closer is typed by hand.
	test('a closer typed by hand seats the next byte outside', async ({ page }) => {
		await page.keyboard.type('*ab* z');
		await ep.bridge.waitForSourceContains('plain tail*ab* z');
	});

	test('a link typed to completion keeps typing after it', async ({ page }) => {
		await page.keyboard.type(' [ab](u) z');
		await ep.bridge.waitForSourceContains('plain tail [ab](u) z');
	});
});

test.describe('live mode — the pairs the destructive-edges rows never covered', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	for (const [word, contentEnd, , , shortened] of [
		['em', 8, '*', '', 'Some *e* text'],
		['code', 10, '`', '', 'Some `cod` text'],
		['strike', 13, '~~', '', 'Some ~~strik~~ text']
	] as const) {
		test(`Backspace at ${word}’s trailing edge takes the content byte`, async ({ page }) => {
			await clickWordSettled(ep, page, word);
			await landAt(ep, page, contentEnd);
			await page.keyboard.press('Backspace');
			await ep.bridge.waitForSourceContains(shortened);
		});
	}

	test('Backspace at a code span’s trailing edge from outside takes the same byte', async ({
		page
	}) => {
		await atEnd(ep, page, 2, 10);
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some `cod` text');
	});

	test('Enter inside a code span closes and reopens it', async ({ page }) => {
		await clickWordSettled(ep, page, 'code');
		await landAt(ep, page, 8);
		await page.keyboard.press('Enter');
		await ep.bridge.waitForSourceContains('Some `co`\n\n`de` text');
		await expect.poll(() => focusOffset(ep)).toBe(0);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('`Yde`');
	});
});

const CELL_DOC = '| a | b |\n| --- | --- |\n| Some **strong** tail | plain |\n';

test.describe('live mode — the same gestures in a table cell', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', CELL_DOC);
	});

	test('the closer typed over a hidden closer steps past it', async ({ page }) => {
		await clickWordSettled(ep, page, 'strong');
		await landAt(ep, page, 13);
		await page.keyboard.type('**X');
		await ep.bridge.waitForSourceContains('| Some **strong**X tail |');
	});

	test('a closer typed by hand seats the next byte outside', async ({ page }) => {
		const cell = page
			.locator("[role='table'] [contenteditable='true']")
			.filter({ hasText: 'plain' });
		await cell.first().click();
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		await page.keyboard.type('*ab* z');
		await ep.bridge.waitForSourceContains('| plain*ab* z |');
		expect(await ep.bridge.getSource()).not.toContain('z*');
	});
});
