import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { clickBlockSettled, enterPresentationMode, focusOffset, stepTo } from './helpers';

// The § 5 row "Mod+B over a selection": the half of the chord that writes bytes at once, in
// the mode that paints none of them. The source is the oracle; the rendered element is what
// the user actually sees change.
// Requirements: e2e/requirements/presentation/presentation-live-selection-toggle.md.

const DOC = ['plain words here', '', '**already bold** tail', '', '## Heading words'].join('\n');

const PLAIN = 0;
const BOLD = 1;
const HEADING = 2;

const CHORD = {
	strong: `${primaryModifier}+b`,
	strikethrough: `${primaryModifier}+Shift+X`,
	inlineCode: `${primaryModifier}+e`
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

			await page.keyboard.press(`${primaryModifier}+z`);
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

		await page.keyboard.press(`${primaryModifier}+z`);
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
});
