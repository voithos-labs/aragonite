import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

// What a destructive key takes in live mode, where no delimiter is painted: the adjacent CONTENT
// character, the pair that character emptied, or an atomic run whole. The source is the oracle —
// a hidden byte and a deleted byte look identical on screen.
// Requirements: e2e/requirements/presentation/presentation-live-editing.md.

const DOC = [
	'## Heading',
	'',
	'Some **bold** text',
	'',
	'**b** tail',
	'',
	'a \\* b',
	'',
	'first line\\',
	'second line',
	'',
	'Setext',
	'======',
	'',
	'plain'
].join('\n');

const BOLD = 1;
const TINY_BOLD = 2;
const ESCAPE = 3;

// The attribute check is load-bearing: an unwhitelisted query param falls back to source, where
// every gesture below is the ordinary one and the live rows would pass without live. Source
// itself stamps no attribute, which is that same fact from the other side.
async function enterMode(page: Page, mode: 'live' | 'source'): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(`?presentationMode=${mode}`);
	await ep.loadContent(DOC);
	if (mode === 'source') await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	else await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
	return ep;
}

async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

/** A click's caret is what every scenario starts from, and the bridge reporting NO selection is
 *  the shape a lost click takes — so settle on the caret existing rather than on the click. */
async function settleCaret(ep: EditorPage): Promise<void> {
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

async function clickBlock(ep: EditorPage, index: number): Promise<void> {
	await ep.clickBlock(index);
	await settleCaret(ep);
}

async function clickWord(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await settleCaret(ep);
}

/** Step with `key` until the caret reports `target` — the arrival is a real gesture, never a
 *  programmatic seat. */
async function stepTo(ep: EditorPage, page: Page, key: string, target: number): Promise<void> {
	for (let i = 0; i < 16; i++) {
		if ((await focusOffset(ep)) === target) return;
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
	throw new Error(`stepTo: ${key} never reached offset ${target} (at ${await focusOffset(ep)})`);
}

test.describe('live mode — a destructive key at a hidden run takes what the reader sees', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterMode(page, 'live');
	});

	test('Backspace after a bold word’s last character deletes the character', async ({ page }) => {
		await clickWord(ep, page, 'bold');
		await stepTo(ep, page, 'ArrowRight', 11);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some **bol** text');

		const block = ep.getBlock(BOLD);
		await expect(block).toHaveText('Some bol text', { useInnerText: true });
		await expect(block.locator('strong')).toHaveText('bol', { useInnerText: true });
	});

	// The whole reason the arm owns this press: the pair the cut empties is invisible, so leaving
	// it behind would put bytes in the document the user can neither see nor explain.
	test('emptying a bold construct drops its delimiters in the same undo entry', async ({
		page
	}) => {
		await clickBlock(ep, TINY_BOLD);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 3);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('\n tail');
		await ep.bridge.waitForSourceNotContains('****');
		await ep.bridge.waitForSourceNotContains('**b**');

		await ep.undo();
		await ep.bridge.waitForSourceContains('**b** tail');
	});

	// `\*` is one character to the reader and two bytes that mean nothing apart.
	test('Backspace beside an escape takes both of its bytes', async ({ page }) => {
		await clickBlock(ep, ESCAPE);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 4);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('a  b');
		await ep.bridge.waitForSourceNotContains('a \\');
	});

	// A hard break's marker run and its line ending are one thing on screen: the line ends.
	test('Backspace at a hard-broken line’s start takes the break whole', async ({ page }) => {
		await clickWord(ep, page, 'second');
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('first linesecond line');
		await ep.bridge.waitForSourceNotContains('line\\');
	});
});

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test.describe('source mode — the same gesture stays byte-literal', () => {
	test('Backspace inside a bold pair deletes the delimiter it is against', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickBlock(ep, TINY_BOLD);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 5);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('**b* tail');
	});
});
