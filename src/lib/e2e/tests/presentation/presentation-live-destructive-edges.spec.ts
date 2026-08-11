import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	stepTo
} from './helpers';

// What a destructive key takes in live mode, where no delimiter is painted: the adjacent CONTENT
// character, the pair that character emptied, or an atomic run whole. The source is the oracle —
// a hidden byte and a deleted byte look identical on screen.
// Requirements: e2e/requirements/presentation/presentation-live-destructive-edges.md.

const DOC = [
	'Some **bold** text',
	'',
	'**b** tail',
	'',
	'a \\* b',
	'',
	'first line\\',
	'second line',
	'',
	'**a *b* c**',
	'',
	'**a** **b**',
	'',
	'merge target',
	'',
	'\\*c\\*'
].join('\n');

const BOLD = 0;
const TINY_BOLD = 1;
const ESCAPE = 2;
const UNSOUND = 4;
const TWO_BOLDS = 5;
const MERGE_TARGET = 6;
const LEADING_ESCAPE = 7;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

test.describe('live mode — a destructive key at a hidden run takes what the reader sees', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterMode(page, 'live');
	});

	test('Backspace after a bold word’s last character deletes the character', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some **bol** text');

		const block = ep.getBlock(BOLD);
		await expect(block).toHaveText('Some bol text', { useInnerText: true });
		await expect(block.locator('strong')).toHaveText('bol', { useInnerText: true });
	});

	// The engine deletes from where the BYTE is, not from where the caret started, so the first
	// content character is destructive one press before the construct's edge: native turns this
	// press into `Some **old text`, the closing run gone with the character.
	test('Backspace on the first content character keeps the construct', async ({ page }) => {
		await clickWordSettled(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowLeft', 8);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some **old** text');
		await expect(ep.getBlock(BOLD).locator('strong')).toHaveText('old', { useInnerText: true });
	});

	// The whole reason the arm owns this press: the pair the cut empties is invisible, so leaving
	// it behind would put bytes in the document the user can neither see nor explain.
	test('emptying a bold construct drops its delimiters in the same undo entry', async ({
		page
	}) => {
		await clickBlockSettled(ep, TINY_BOLD);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 3);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('\n tail');
		await ep.bridge.waitForSourceNotContains('****');
		await ep.bridge.waitForSourceNotContains('**b** tail');

		await ep.undo();
		await ep.bridge.waitForSourceContains('**b** tail');
	});

	// `\*` is one character to the reader and two bytes that mean nothing apart.
	test('Backspace beside an escape takes both of its bytes', async ({ page }) => {
		await clickBlockSettled(ep, ESCAPE);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 4);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('a  b');
		await ep.bridge.waitForSourceNotContains('a \\');
	});

	// The landable start is visual column 0: the press is the block's merge, and the escape's
	// first visible glyph must survive it (GH #108 turned this press into a forward delete).
	test('Backspace at the landable start inside a leading escape merges the blocks', async ({
		page
	}) => {
		await clickBlockSettled(ep, LEADING_ESCAPE);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(1);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('merge target\\*c\\*');
		await expect(ep.getBlock(MERGE_TARGET)).toHaveText('merge target*c*', {
			useInnerText: true
		});
	});

	// A hard break's marker run and its line ending are one thing on screen: the line ends.
	test('Backspace at a hard-broken line’s start takes the break whole', async ({ page }) => {
		await clickWordSettled(ep, page, 'second');
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('first linesecond line');
		await ep.bridge.waitForSourceNotContains('line\\');
	});
});

// Two readings of the same press, and the arm takes whichever one parses back. Deleting the
// character between two bold words joins them; deleting the one before a nested construct has no
// reading at all, and handing THAT press to the engine destroys both constructs.
test.describe('live mode — the widened cut, and the press with no reading at all', () => {
	test('deleting the space between two bold words joins them', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickBlockSettled(ep, TWO_BOLDS);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 3);

		await page.keyboard.press('Delete');
		await ep.bridge.waitForSourceContains('**ab**');
		await ep.bridge.waitForSourceNotContains('****');

		const block = ep.getBlock(TWO_BOLDS);
		await expect(block).toHaveText('ab', { useInnerText: true });
		await expect(block.locator('strong')).toHaveText('ab', { useInnerText: true });
	});

	test('Backspace that could only surface delimiters leaves the bytes alone', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickBlockSettled(ep, UNSOUND);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 3);
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Backspace');
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
		await expect(ep.getBlock(UNSOUND)).toHaveText('a b c', { useInnerText: true });
	});
});

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test.describe('source mode — the same gesture stays byte-literal', () => {
	test('Backspace inside a bold pair deletes the delimiter it is against', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickBlockSettled(ep, TINY_BOLD);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 5);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('**b* tail');
	});
});
