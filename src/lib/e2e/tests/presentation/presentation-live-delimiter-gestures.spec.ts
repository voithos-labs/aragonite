import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickEnd,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	landAt,
	nextRow,
	stepTo
} from './helpers';

// Typing a construct closed and leaving it in live mode: auto-pairing and where the typed byte
// goes, as one gesture. The source is the reference throughout. Each test walks its rows as
// steps, every step on a fresh copy of the document.
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

async function atEnd(ep: EditorPage, page: Page, block: number, target: number): Promise<void> {
	await clickBlockSettled(ep, block);
	await page.keyboard.press('End');
	await ep.waitForRenderFlush();
	await stepTo(ep, page, 'ArrowLeft', target);
}

test('live mode: the closer typed over a hidden closer steps past it', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	for (const [word, contentEnd, closer, after] of PAIRS) {
		await test.step(`${word}: the next byte lands after the construct`, async () => {
			await nextRow(ep, DOC);
			await clickWordSettled(ep, page, word);
			await landAt(ep, page, contentEnd);
			await page.keyboard.type(closer);
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(after);
		});
	}

	await test.step('arrived from outside, the press steps past it all the same', async () => {
		await nextRow(ep, DOC);
		await atEnd(ep, page, STRONG, 13);
		await page.keyboard.type('**X');
		await ep.bridge.waitForSourceContains('Some **strong**X text');
	});

	// The byte lands past the closer, and the auto-pair still writes its partner there.
	await test.step('a delimiter typed at the trailing edge from outside lands its paired closer past the closer', async () => {
		await nextRow(ep, DOC);
		await atEnd(ep, page, STRONG, 13);
		await page.keyboard.type('`');
		await ep.bridge.waitForSourceContains('Some **strong**`` text');
	});
});

// Where the screen paints the closer, typing it steps past the closer the user sees.
for (const mode of ['source', 'preview-block', 'preview-inline'] as const) {
	test(`${mode}: typing the painted closer steps past it`, async ({ page }) => {
		const ep = await enterPresentationMode(page, mode, DOC);

		for (const [word, closer, after] of [
			['strong', '**', 'Some **strong**X text'],
			['code', '`', 'Some `code`X text']
		] as const) {
			await test.step(`${word}: the next byte lands after the construct`, async () => {
				await nextRow(ep, DOC);
				await clickEnd(ep, page, word);
				await page.keyboard.type(closer);
				await page.keyboard.type('X');
				await ep.bridge.waitForSourceContains(after);
			});
		}
	});
}

// A backtick typed at a hidden closer pairs where it lands, and the auto-pair records the pair as
// its own: Backspace between the two takes both.
test('live mode: Backspace takes both of a pair written at a hidden closer', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', 'x **b** y\n');
	await ep.focusBlock(0, 7);
	await page.keyboard.type('`');
	await ep.bridge.waitForSourceMatches(/``/);
	await page.keyboard.press('Backspace');

	await expect.poll(() => ep.bridge.getSource()).toBe('x **b** y\n');
});

test('live mode: a construct typed to completion is left behind', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atPlainEnd = async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
	};

	// `tail*` pairs nothing (an opener straight after a word byte), so the closer is typed by hand.
	await test.step('a closer typed by hand puts the caret at the next byte outside', async () => {
		await atPlainEnd();
		await page.keyboard.type('*ab* z');
		await ep.bridge.waitForSourceContains('plain tail*ab* z');
	});

	await test.step('a link typed to completion keeps typing after it', async () => {
		await atPlainEnd();
		await page.keyboard.type(' [ab](u) z');
		await ep.bridge.waitForSourceContains('plain tail [ab](u) z');
	});
});

test('live mode: the pairs the destructive-edges rows never covered', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	for (const [word, contentEnd, shortened] of [
		['em', 8, 'Some *e* text'],
		['code', 10, 'Some `cod` text'],
		['strike', 13, 'Some ~~strik~~ text']
	] as const) {
		await test.step(`Backspace at ${word}’s trailing edge takes the content byte`, async () => {
			await nextRow(ep, DOC);
			await clickWordSettled(ep, page, word);
			await landAt(ep, page, contentEnd);
			await page.keyboard.press('Backspace');
			await ep.bridge.waitForSourceContains(shortened);
		});
	}

	await test.step('Backspace at a code span’s trailing edge from outside takes the same byte', async () => {
		await nextRow(ep, DOC);
		await atEnd(ep, page, 2, 10);
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some `cod` text');
	});

	await test.step('Enter inside a code span closes and reopens it', async () => {
		await nextRow(ep, DOC);
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

test('live mode: the same gestures in a table cell', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', CELL_DOC);

	await test.step('the closer typed over a hidden closer steps past it', async () => {
		await nextRow(ep, CELL_DOC);
		await clickWordSettled(ep, page, 'strong');
		await landAt(ep, page, 13);
		await page.keyboard.type('**X');
		await ep.bridge.waitForSourceContains('| Some **strong**X tail |');
	});

	await test.step('a closer typed by hand puts the caret at the next byte outside', async () => {
		await nextRow(ep, CELL_DOC);
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
