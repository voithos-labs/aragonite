import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickWordSettled, enterPresentationMode, extendTo, landAt, stepTo } from './helpers';

// A live cut in a list item's first line cleans up the way it does at the top level, and the
// tree it leaves is the one a reload reads. The source is the reference, since a hidden delimiter
// and an absent one look the same on screen.
// Requirements: e2e/requirements/presentation/presentation-live-join-containers.md.

const ITEM = [0, 0, 0];

/** Caret after `bo` inside the bold run, then a real Shift-extend to just after `it` inside the
 *  italic: both endpoints strictly inside a construct, which strands both runs. */
async function selectBoldIntoItalic(ep: EditorPage, page: Page): Promise<void> {
	await clickWordSettled(ep, page, 'Some');
	await stepTo(ep, page, 'ArrowRight', 9);
	await extendTo(ep, page, 'ArrowRight', ITEM, 21);
}

async function expectCleanAndConverged(ep: EditorPage, source: string): Promise<void> {
	await ep.bridge.waitForSourceContains(source);
	expect(await ep.bridge.getSource()).not.toContain('**');
	await expect(ep.getBlock(0)).not.toContainText('*');
	expect(await ep.parseConverged()).toBe(true);
}

test.describe('live mode: a selection out of one construct and into another, in a list item', () => {
	const DOC = '- Some **bold** and *italic* words\n';

	test('Backspace joins the text and takes both stranded runs with it', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('Backspace');
		await expectCleanAndConverged(ep, '- Some boalic words\n');
	});

	test('typing over the selection lands the character at the cleaned join', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.type('X');
		await expectCleanAndConverged(ep, '- Some boXalic words\n');
	});

	test('Mod+X leaves the same bytes', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('ControlOrMeta+x');
		await expectCleanAndConverged(ep, '- Some boalic words\n');
	});

	test('a to-do item cleans up the same way and keeps its checkbox', async ({ page }) => {
		const ep = await enterPresentationMode(
			page,
			'live',
			'- [ ] Some **bold** and *italic* words\n'
		);
		await selectBoldIntoItalic(ep, page);

		await page.keyboard.press('Backspace');
		await expectCleanAndConverged(ep, '- [ ] Some boalic words\n');
	});
});

test.describe('live mode: the join across two list items', () => {
	// Once the selection crosses into the next item it extends whole blocks, so the far endpoint is
	// that item's start and only the run behind the first endpoint is stranded.
	test('the stranded run goes with the second item', async ({ page }) => {
		const ep = await enterPresentationMode(
			page,
			'live',
			'- Alpha **beta** gamma\n- delta *epsilon* zeta\n'
		);
		await clickWordSettled(ep, page, 'Alpha');
		await stepTo(ep, page, 'ArrowRight', 10);
		await extendTo(ep, page, 'ArrowRight', [0, 1, 0], 0);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('- Alpha bedelta *epsilon* zeta\n');
		expect(await ep.bridge.getSource()).not.toContain('**be');
		expect(await ep.parseConverged()).toBe(true);
	});
});

test.describe('live mode: Backspace at a hidden run at an item’s start', () => {
	test('takes the letter and the emptied pair, and the marker takes the space', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', '- **a** tail\n');
		await clickWordSettled(ep, page, 'tail');
		await landAt(ep, page, 3);

		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('-  tail\n');
		await expect(ep.getBlock(0)).not.toContainText('*');
		expect(await ep.parseConverged()).toBe(true);
	});
});
