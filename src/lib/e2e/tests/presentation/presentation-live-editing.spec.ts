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

const HEADING = 0;
const BOLD = 1;
const TINY_BOLD = 2;
const ESCAPE = 3;
const SETEXT = 5;

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

async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

/** Step with `key` until the caret reports `target` — the arrival is a real gesture, never a
 *  programmatic seat. A walk that leaves the block is a failure, not a longer walk: the offsets
 *  restart there, and the target would be reached in the wrong block. */
async function stepTo(ep: EditorPage, page: Page, key: string, target: number): Promise<void> {
	const start = await focusPath(ep);
	for (let i = 0; i < 16; i++) {
		if ((await focusOffset(ep)) === target) return;
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
		const path = await focusPath(ep);
		if (path.join() !== start.join()) {
			throw new Error(`stepTo: ${key} left block [${start}] for [${path}]`);
		}
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

// The heading is the document's FIRST block, where the merge cascade returns early — placing the
// demote at the command arm rather than inside the merge is what makes the press work here.
test.describe('live mode — Backspace at a heading’s content start demotes before it merges', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterMode(page, 'live');
	});

	test('the first press demotes at document index 0, and one Mod+Z puts the heading back', async ({
		page
	}) => {
		await clickBlock(ep, HEADING);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Heading\n');
		await ep.bridge.waitForSourceNotContains('## Heading');
		expect(await ep.bridge.getBlockKind(HEADING)).toBe('paragraph');

		await ep.undo();
		await ep.bridge.waitForSourceContains('## Heading');
		expect(await ep.bridge.getBlockKind(HEADING)).toBe('heading');
	});

	// Demote FIRST, merge second: the cascade is untouched, it just no longer sees the first press.
	test('the second press merges, through the untouched cascade', async ({ page }) => {
		await clickBlock(ep, BOLD);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('HeadingSome **bold** text');
	});

	// The other end of the same block: Delete there would merge the next block PAST the underline
	// and surface it, so the press is consumed until the join seams can keep a block's structure.
	test('Delete at a setext heading’s content end takes nothing', async ({ page }) => {
		await clickBlock(ep, SETEXT);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Delete');
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
	});

	// Setext keeps its structure as a trailing underline, so the same declaration has to reach the
	// press from the other end — the line goes, the text stays.
	test('a setext heading gives up its underline', async ({ page }) => {
		await clickBlock(ep, SETEXT);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Setext\n');
		await ep.bridge.waitForSourceNotContains('======');
		expect(await ep.bridge.getBlockKind(SETEXT)).toBe('paragraph');
	});
});

// Source paints every delimiter, so the byte the caret is against is the byte the user aimed at.
test.describe('source mode — the same gestures stay byte-literal', () => {
	test('Backspace inside a bold pair deletes the delimiter it is against', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickBlock(ep, TINY_BOLD);
		await page.keyboard.press('End');
		await stepTo(ep, page, 'ArrowLeft', 5);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('**b* tail');
	});

	// The `## ` is on screen and raw 0 is the block's start, so the press is the merge it has
	// always been — at document index 0, the cascade's own no-op.
	test('Backspace inside a heading’s prefix deletes a marker byte, and never demotes', async ({
		page
	}) => {
		const ep = await enterMode(page, 'source');
		await clickBlock(ep, HEADING);
		// Home reaches raw 0 here, which live has no caret for at all.
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowRight', 2);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('# Heading');
		await ep.bridge.waitForSourceNotContains('## Heading');
		expect(await ep.bridge.getBlockKind(HEADING)).toBe('heading');
	});
});
