import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickWordSettled, landAt } from '../presentation/helpers';

// A format toggle over a cross-block range rewrites every participating block under one undo
// entry: the anchor block's tail, each middle block's content, the focus block's head. Which way
// it goes depends on coverage across the range: all covered removes the format, anything else
// applies it. Non-prose blocks and the link editor stay out.

const TWO = 'First block here\n\nSecond block here\n';
const BOTH_BOLD = '**First block here**\n\n**Second block here**\n';
const ONE_BOLD = '**First block here**\n\nSecond block here\n';

async function selectWholeDocument(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlock(0, 3);
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ControlOrMeta+a');
	await ep.waitForCrossBlock(true);
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`cross-block format toggle: ${mode}`, () => {
		let ep: EditorPage;

		test.beforeEach(async ({ page }) => {
			ep = new EditorPage(page);
			await ep.goto(mode === 'source' ? '' : `?presentationMode=${mode}`);
		});

		test('Mod+B over two plain paragraphs wraps each block on its own', async ({ page }) => {
			await ep.loadContent(TWO);
			await ep.waitForRenderFlush();
			await selectWholeDocument(ep, page);
			await page.keyboard.press('ControlOrMeta+b');
			await ep.bridge.waitForSourceEquals(BOTH_BOLD, 3000);
		});

		test('Mod+B over two already-bold paragraphs unwraps both', async ({ page }) => {
			await ep.loadContent(BOTH_BOLD);
			await ep.waitForRenderFlush();
			await selectWholeDocument(ep, page);
			await page.keyboard.press('ControlOrMeta+b');
			await ep.bridge.waitForSourceEquals(TWO, 3000);
		});

		test('one bold and one plain applies: the plain block wraps, the bold one is untouched', async ({
			page
		}) => {
			await ep.loadContent(ONE_BOLD);
			await ep.waitForRenderFlush();
			await selectWholeDocument(ep, page);
			await page.keyboard.press('ControlOrMeta+b');
			await ep.bridge.waitForSourceEquals(BOTH_BOLD, 3000);
		});
	});
}

test.describe('what the press skips and what it costs', () => {
	test('a code block between two paragraphs keeps its bytes while both paragraphs wrap', async ({
		page
	}) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent('First block here\n\n```\nlet x = 1\n```\n\nSecond block here\n');
		await ep.waitForRenderFlush();
		await selectWholeDocument(ep, page);
		await page.keyboard.press('ControlOrMeta+b');
		await ep.bridge.waitForSourceEquals(
			'**First block here**\n\n```\nlet x = 1\n```\n\n**Second block here**\n',
			3000
		);
	});

	// Every other scenario builds the range with Mod+A, so both endpoint blocks are whole. A
	// shift-click landing on the start of a word gives the focus block a head span ending in a
	// space: the edge where markdown cannot close a run, and where a source-mode press writes
	// delimiters that form no construct.
	test('a partial range marks each endpoint span, trimming the space at its edge', async ({
		page
	}) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent('alpha beta\n\ngamma delta\n');
		await ep.waitForRenderFlush();

		await ep.focusBlock(0, 'alpha '.length);
		await ep.shiftClickBlock([1], 'gamma '.length);
		await ep.waitForCrossBlock(true);

		await page.keyboard.press('ControlOrMeta+b');
		await ep.bridge.waitForSourceEquals('alpha **beta**\n\n**gamma** delta\n', 3000);
	});

	// The commit runs over the whole document precisely so a block no container mounted still
	// gets written; every other case here fits in one render window and would not notice.
	test('a block windowed out of the DOM is marked like the rest', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		const lines = Array.from({ length: 120 }, (_, i) => `block ${i} here`);
		await ep.loadContent(`${lines.join('\n\n')}\n`);
		await ep.waitForRenderFlush();
		expect(await ep.getDomBlockCount()).toBeLessThan(lines.length);

		await selectWholeDocument(ep, page);
		await page.keyboard.press('ControlOrMeta+b');
		await ep.bridge.waitForSourceEquals(
			`${lines.map((line) => `**${line}**`).join('\n\n')}\n`,
			5000
		);
	});

	test('one undo restores both blocks', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(TWO);
		await ep.waitForRenderFlush();
		await selectWholeDocument(ep, page);
		await page.keyboard.press('ControlOrMeta+b');
		await ep.bridge.waitForSourceEquals(BOTH_BOLD, 3000);

		await ep.undo();
		await ep.bridge.waitForSourceEquals(TWO, 3000);
	});

	// The cross-block keydown handler takes every default toggle chord, so a rebound chord is
	// the one gesture that proves the leaf's own dispatch reaches the cross-block path too.
	test('Mod+Alt+G rebound to the strong toggle wraps the range like the default chord', async ({
		page
	}) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(TWO);
		await ep.waitForRenderFlush();
		await page.evaluate(() =>
			(window as any).__test.setKeybindings([
				{ chord: 'Mod+Alt+G', command: 'format.toggleStrong' }
			])
		);
		await selectWholeDocument(ep, page);
		await page.keyboard.press('ControlOrMeta+Alt+g');
		await ep.bridge.waitForSourceEquals(BOTH_BOLD, 3000);
	});
});

test.describe('the sibling that stays declined: Mod+K over a cross-block range', () => {
	// Entering cross-block leaves a collapsed native caret at the anchor, so the link card's
	// native-collapse check on its own reads a painted range as an ordinary caret.
	const LINKED = 'Visit [example](https://example.com) now\n\nSecond block here\n';

	test('opens no card and edits no bytes while the range is painted', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(LINKED);
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		// Step the caret into the link text with arrows: a click there would open the card.
		await clickWordSettled(ep, page, 'Visit');
		await landAt(ep, page, 9);
		// The first press may extend natively inside the block; keep going until the range is
		// the editor's. The anchor, where the collapsed native caret sits, stays in the link.
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Shift+ArrowDown');
			await ep.waitForRenderFlush();
			if ((await page.locator('[data-cross-block]').count()) > 0) break;
		}
		await ep.waitForCrossBlock(true);

		await ep.pressDeclined('ControlOrMeta+k');
		await ep.waitForRenderFlush();

		await expect(page.locator('[data-link-card]')).toHaveCount(0);
		expect(await ep.bridge.getSource()).toBe(before);
		await ep.waitForCrossBlock(true);
	});
});

test.describe('the sibling that stays destructive: cross-block type-replace', () => {
	test('plain typing over the range still replaces it in one undo entry', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent('First block here\n\nSecond block here\n\nThird block here\n');
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		await selectWholeDocument(ep, page);
		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).not.toContain('First block');

		await ep.undo();
		await ep.bridge.waitForSourceEquals(before, 3000);
	});
});
