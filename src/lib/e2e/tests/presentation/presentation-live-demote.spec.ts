import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, stepTo } from './helpers';

// Backspace at a live heading's content start: the block gives up its own structure before the
// merge cascade sees the press. The source and the block kind are the oracles — the `## ` the
// press removes was never on screen.
// Requirements: e2e/requirements/presentation/presentation-live-demote.md.

const DOC = [
	'## Heading',
	'',
	'Some text',
	'',
	'  ## Indented',
	'',
	'## **B** head',
	'',
	'## [B][r] head',
	'',
	'[B][r] tail',
	'',
	'Setext',
	'======',
	'',
	'plain',
	'',
	'[r]: https://example.com'
].join('\n');

const HEADING = 0;
const FOLLOWER = 1;
const INDENTED = 2;
const CONSTRUCT_LED = 3;
const REFERENCE_LED = 4;
const REFERENCE_PARA = 5;
const SETEXT = 6;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

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
		await clickBlockSettled(ep, HEADING);
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

	// Demote FIRST, merge second: the cascade is untouched, it just never sees the first press.
	test('the second press merges, through the untouched cascade', async ({ page }) => {
		await clickBlockSettled(ep, FOLLOWER);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('HeadingSome text');
	});

	// The gate is the kind's content range, which skips the indent; a rewrite anchored on the `#`s
	// instead writes the block back unchanged and the press disappears entirely.
	test('an indented heading demotes too', async ({ page }) => {
		await clickBlockSettled(ep, INDENTED);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Indented\n');
		await ep.bridge.waitForSourceNotContains('## Indented');
		expect(await ep.bridge.getBlockKind(INDENTED)).toBe('paragraph');
	});

	// Two hidden runs stand between raw 0 and the first visible byte, and the caret walk reports
	// the offset of that byte — a bound at the model's content start matches no caret at all.
	test('a heading opening with a construct demotes at the caret Home leaves', async ({ page }) => {
		await clickBlockSettled(ep, CONSTRUCT_LED);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('**B** head');
		await ep.bridge.waitForSourceNotContains('## **B** head');
		expect(await ep.bridge.getBlockKind(CONSTRUCT_LED)).toBe('paragraph');
	});

	// A reference construct is only a construct once the document's definitions resolve it: read
	// without them `[B][r]` is plain text and the bound never clears its hidden `[`.
	test('a heading opening with a reference link demotes', async ({ page }) => {
		await clickBlockSettled(ep, REFERENCE_LED);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('\n[B][r] head');
		await ep.bridge.waitForSourceNotContains('## [B][r] head');
		expect(await ep.bridge.getBlockKind(REFERENCE_LED)).toBe('paragraph');
	});

	// The same bound on a kind that declares no demote: the press has to reach the cascade.
	test('a paragraph opening with a reference link still merges', async ({ page }) => {
		await clickBlockSettled(ep, REFERENCE_PARA);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('## [B][r] head[B][r] tail');
	});

	// Setext keeps its structure as a trailing underline, so the same declaration has to reach the
	// press from the other end — the line goes, the text stays.
	test('a setext heading gives up its underline', async ({ page }) => {
		await clickBlockSettled(ep, SETEXT);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Setext\n');
		await ep.bridge.waitForSourceNotContains('======');
		expect(await ep.bridge.getBlockKind(SETEXT)).toBe('paragraph');
	});

	// The other end of the same block: Delete there would merge the next block PAST the underline
	// and surface it, so the press is consumed until the join seams can keep a block's structure.
	test('Delete at a setext heading’s content end takes nothing', async ({ page }) => {
		await clickBlockSettled(ep, SETEXT);
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Delete');
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
	});
});

// The `## ` is on screen and raw 0 is the block's start, so the press is the merge it has always
// been — at document index 0, the cascade's own no-op.
test.describe('source mode — the prefix is painted, so nothing demotes', () => {
	test('Backspace inside a heading’s prefix deletes a marker byte', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickBlockSettled(ep, HEADING);
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
