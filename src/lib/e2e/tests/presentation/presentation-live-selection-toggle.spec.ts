import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset, stepTo } from './helpers';

// The § 5 row "Mod+B over a selection": the half of the chord that writes bytes at once, in
// the mode that paints none of them. The source is the oracle; the rendered element is what
// the user actually sees change.
// Requirements: e2e/requirements/presentation/presentation-live-selection-toggle.md.

const DOC = [
	'plain words here',
	'',
	'**already bold** tail',
	'',
	'## Heading words',
	'',
	'~~already struck~~ tail',
	'',
	'`already code` tail'
].join('\n');

const PLAIN = 0;
const BOLD = 1;
const HEADING = 2;
const STRUCK = 3;
const CODE = 4;

const CHORD = {
	strong: 'ControlOrMeta+b',
	strikethrough: 'ControlOrMeta+Shift+X',
	inlineCode: 'ControlOrMeta+e'
} as const;

/** Seat the caret at `from` and extend `length` characters rightward with real presses. Home
 *  lands at the block's first landable offset, which a leading hidden run moves off raw 0. */
async function selectFrom(
	ep: EditorPage,
	page: Page,
	block: number,
	from: number,
	length: number
): Promise<void> {
	await clickBlockSettled(ep, block);
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
	await stepTo(ep, page, 'ArrowRight', from);
	expect(await focusOffset(ep)).toBe(from);
	for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight');
	await ep.waitForRenderFlush();
}

test.describe('live mode — a toggle over a selection writes its bytes at once', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	for (const [format, wrapped] of [
		['strong', '**words**'],
		['strikethrough', '~~words~~'],
		['inlineCode', '`words`']
	] as const) {
		test(`${format} wraps the selection and one undo takes it back`, async ({ page }) => {
			await selectFrom(ep, page, PLAIN, 6, 5);
			await page.keyboard.press(CHORD[format]);
			await ep.bridge.waitForSourceContains(wrapped);

			await page.keyboard.press('ControlOrMeta+z');
			await ep.bridge.waitForSourceContains('plain words here');
			expect(await ep.bridge.getSource()).toContain('plain words here');
		});
	}

	test('the wrap renders as the construct, with its delimiters unpainted', async ({ page }) => {
		await selectFrom(ep, page, PLAIN, 6, 5);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('**words**');

		await expect(ep.getBlock(PLAIN).locator('strong')).toHaveText('words');
		await expect(ep.getBlock(PLAIN).locator('.md-marker').first()).toHaveCSS('display', 'none');
	});

	test('a selection over an already-bold word strips the pair', async ({ page }) => {
		// `**already bold**`: the whole construct, delimiters included, is offsets 0..16.
		await selectFrom(ep, page, BOLD, 2, 12);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('already bold tail');
		expect(await ep.bridge.getSource()).not.toContain('**already bold**');
	});

	// The strip half for the other two runs: `~~` is two bytes and a code fence sizes itself, so
	// the pair each one takes back off is read off its own parse rather than off the chord.
	for (const [format, block, from, length, stripped] of [
		['strikethrough', STRUCK, 2, 14, 'already struck tail'],
		['inlineCode', CODE, 1, 12, 'already code tail']
	] as const) {
		test(`a selection over an already-${format} word strips the pair`, async ({ page }) => {
			await selectFrom(ep, page, block, from, length);
			await page.keyboard.press(CHORD[format]);
			await ep.bridge.waitForSourceContains(stripped);
		});
	}

	// A run closes against a word, so wrapping the space would print four asterisks the reader
	// cannot see to delete. The word goes in the run and the space stays beside it.
	test('a selection ending on a space wraps the word alone', async ({ page }) => {
		await selectFrom(ep, page, PLAIN, 6, 6);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('**words** here');

		// The space is beside the run, not in it, so the literal wrap's four asterisks never appear.
		await expect(ep.getBlock(PLAIN).locator('strong')).toHaveText('words');
		expect(await ep.bridge.getSource()).not.toContain('**words **');
	});

	test('a toggle inside a heading leaves the unpainted prefix alone', async ({ page }) => {
		// Home lands past the hidden `## `, so the selection can only start in content.
		await selectFrom(ep, page, HEADING, 3, 7);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('## **Heading**');
	});
});

test.describe('live mode — the toggle is its own undo entry', () => {
	test('one undo after typing then toggling keeps the typed bytes', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('End');
		await page.keyboard.type(' typed');
		await ep.bridge.waitForSourceContains('plain words here typed');

		await selectFrom(ep, page, PLAIN, 6, 5);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('**words**');

		await page.keyboard.press('ControlOrMeta+z');
		await ep.bridge.waitForSourceContains('plain words here typed');
		// The batch the chord interrupted survives: the toggle owns its entry alone.
		expect(await ep.bridge.getSource()).not.toContain('**words**');
	});
});

test.describe('source mode — the same chord writes the same bytes', () => {
	test('the delimiters are painted, and the source is identical', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await selectFrom(ep, page, PLAIN, 6, 5);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('**words**');
		expect(await ep.getBlockText(PLAIN)).toBe('plain **words** here');
	});

	// The one divergence: source paints the run it writes, so the reader can see and fix it.
	test('a selection ending on a space keeps the space inside the run', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await selectFrom(ep, page, PLAIN, 6, 6);
		await page.keyboard.press(CHORD.strong);
		await ep.bridge.waitForSourceContains('**words **here');
	});
});
