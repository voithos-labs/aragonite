import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickWordSettled, enterPresentationMode, extendTo, stepTo } from './helpers';

// What a destructive join writes in live mode: the runs the cut stranded go, the pair it brought
// back to back goes, and the joined text carries no delimiter the reader never typed. The source
// is the oracle — a hidden delimiter and an absent one look identical on screen.
// Requirements: e2e/requirements/presentation/presentation-live-join.md.

const DOC = [
	'Some **bold** and *italic* words',
	'',
	'Alpha **beta** gamma',
	'',
	'delta *epsilon* zeta',
	'',
	'plain words here'
].join('\n');

const MIXED = 0;
const ABOVE = 1;
const PLAIN = 3;

const enterMode = (page: Page, mode: 'live' | 'source') => enterPresentationMode(page, mode, DOC);

/** Caret after `bo` inside the bold run, then a real Shift-extend to just after `it` inside the
 *  italic — both endpoints strictly inside a construct, which is what strands the two runs. */
async function selectBoldIntoItalic(ep: EditorPage, page: Page): Promise<void> {
	await clickWordSettled(ep, page, 'Some');
	await stepTo(ep, page, 'ArrowRight', 9);
	await extendTo(ep, page, 'ArrowRight', [MIXED], 21);
}

test.describe('live mode — a selection out of one construct and into another', () => {
	test('Backspace joins the text and takes both stranded runs with it', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some boalic words');
		expect(await ep.bridge.getSource()).not.toContain('**bo');
		await expect(ep.getBlock(MIXED)).toHaveText('Some boalic words', { useInnerText: true });
	});

	test('Mod+X leaves the same bytes and copies the source slice the selection covered', async ({
		page
	}) => {
		const ep = await enterMode(page, 'live');
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('ControlOrMeta+x');
		await ep.bridge.waitForSourceContains('Some boalic words');
		expect(await ep.bridge.getSource()).not.toContain('**bo');
		// Live copy writes SOURCE bytes (raw 9-21), not the visible text — the consumer guide's contract.
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ld** and *it');
	});

	test('typing over the selection lands the character at the cleaned seam', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some boXalic words');
		expect(await ep.bridge.getSource()).not.toContain('**bo');
	});

	test('one undo puts the original block back', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some boalic words');
		await page.keyboard.press('ControlOrMeta+z');
		await ep.bridge.waitForSourceContains('Some **bold** and *italic* words');
	});
});

test.describe('live mode — the join across a block boundary', () => {
	/**
	 * From inside the bold of one paragraph to the head of the next. Once the selection crosses a
	 * block boundary the extend walks whole blocks (measured), so the far endpoint is a block head
	 * rather than a second construct interior — the two-sided case is unit-pinned instead.
	 */
	async function selectAcrossBlocks(ep: EditorPage, page: Page): Promise<void> {
		await clickWordSettled(ep, page, 'Alpha');
		await stepTo(ep, page, 'ArrowRight', 10);
		await extendTo(ep, page, 'ArrowRight', [ABOVE + 1], 0);
	}

	test('two paragraphs join with the stranded run gone', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await selectAcrossBlocks(ep, page);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Alpha bedelta *epsilon* zeta');
		expect(await ep.bridge.getSource()).not.toContain('Alpha **be');
	});

	// A paste landing exactly where a cleanup dropped runs: the cleanup runs in the delete half
	// and the post-insert re-parse settles the rest.
	test('a paste at the cleaned seam lands its text there', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await selectAcrossBlocks(ep, page);

		await page.evaluate(() => navigator.clipboard.writeText('JOINED'));
		await page.keyboard.press('ControlOrMeta+v');
		await ep.bridge.waitForSourceContains('Alpha beJOINEDdelta *epsilon* zeta');
		expect(await ep.bridge.getSource()).not.toContain('Alpha **be');
	});
});

test.describe('live mode — seams with nothing to clean', () => {
	test('a selection over plain text deletes exactly what it covered', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'plain');
		await stepTo(ep, page, 'ArrowRight', 5);
		await extendTo(ep, page, 'ArrowRight', [PLAIN], 11);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('plain here');
		await expect(ep.getBlock(PLAIN)).toHaveText('plain here', { useInnerText: true });
	});

	// Both endpoints inside ONE construct: its opener and closer meet across the seam, which is
	// what the reader had, so the join keeps the pair rather than dropping it.
	test('a selection inside one construct keeps the construct', async ({ page }) => {
		const ep = await enterMode(page, 'live');
		await clickWordSettled(ep, page, 'Alpha');
		await stepTo(ep, page, 'ArrowRight', 10);
		await extendTo(ep, page, 'ArrowRight', [ABOVE], 11);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Alpha **bea** gamma');
		await expect(ep.getBlock(ABOVE).locator('strong')).toHaveText('bea', { useInnerText: true });
	});
});

// Source paints every delimiter, so the byte the selection covered is the byte the user aimed at.
test.describe('source mode — the same gesture stays byte-literal', () => {
	test('the stranded runs survive the delete', async ({ page }) => {
		const ep = await enterMode(page, 'source');
		await clickWordSettled(ep, page, 'Some');
		await stepTo(ep, page, 'ArrowRight', 9);
		await extendTo(ep, page, 'ArrowRight', [MIXED], 21);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('Some **boalic* words');
	});
});
