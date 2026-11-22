import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode, landAt } from './helpers';
import { clickModeToggle } from '../../mode-switch';
import { textRunCenter } from '../../text-runs';
import { dragBetweenPoints } from '../plugins/helpers';

// The caret half of the mode-switch rules: a mode change moves no byte, so the caret the user
// had comes back on the other side, saved across reading mode, which has no caret.
// Requirements: e2e/requirements/presentation/presentation-mode-flip-caret.md.

const DOC = ['# Title', '', 'Some **bold** and more text'].join('\n');

const PROSE = [1];
// `Some **bo|ld**`: mid-construct, reachable in every mode.
const SEAT = 9;

// A cell's raw is its own, so the same offset reads the same way inside a table.
const TABLE_DOC = ['| Some **bold** cell | b |', '| --- | --- |', '| c | d |'].join('\n');
const CELL = [0, 0, 0];

async function focusPoint(ep: EditorPage): Promise<{ path: number[]; offset: number } | null> {
	return (await ep.bridge.getSelectionPaths())?.focus ?? null;
}

test.describe('mode flips: the caret comes back', () => {
	test('a caret mid-construct in live survives the flip to source and takes the next byte', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);

		await clickModeToggle(page, 'live');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
		expect((await focusPoint(ep))?.path).toEqual(PROSE);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	test('the caret banked entering reading re-puts the caret on the flip out', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);

		await clickModeToggle(page, 'reading');
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSelectionPaths()).toBeNull();

		await clickModeToggle(page, 'reading');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	test('a range dragged across a styled run leaves nothing selected in reading', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await dragBetweenPoints(
			page,
			await textRunCenter(page, 'Some'),
			await textRunCenter(page, 'more')
		);
		await ep.waitForRenderFlush();
		expect(await page.evaluate(() => getSelection()?.toString())).toContain('bold');

		await clickModeToggle(page, 'reading');
		await ep.waitForRenderFlush();
		expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
	});

	test('a click while reading moves the caret the flip out puts back', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);
		await clickModeToggle(page, 'reading');
		await ep.waitForRenderFlush();

		// Reading mode keeps no caret, so the click has none to settle; it focuses the block.
		const title = await textRunCenter(page, 'Title');
		await page.mouse.click(title.x, title.y);
		await ep.waitForRenderFlush();
		await clickModeToggle(page, 'reading');
		await expect.poll(async () => (await focusPoint(ep))?.path).toEqual([0]);

		await page.keyboard.type('X');
		await expect.poll(() => ep.bridge.getSource()).toMatch(/^# T\w*X\w*\n/);
	});

	// A cell keys its DOM on the mode, so a mode change rebuilds every mounted cell and runs the
	// prose capture and restore for a caret three levels deep with no `data-block-path` of its own.
	test('a caret inside a table cell survives the flip and takes the next byte there', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', TABLE_DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);
		expect((await focusPoint(ep))?.path).toEqual(CELL);

		await clickModeToggle(page, 'live');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
		expect((await focusPoint(ep))?.path).toEqual(CELL);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	// Reading is covered by the test above; on the way in it has no caret to assert.
	for (const mode of ['preview-block', 'preview-inline', 'live'] as const) {
		test(`a source caret survives the ${mode} round trip, re-placed on both flips`, async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, 'source', DOC);
			await clickWordSettled(ep, page, 'bold');
			await landAt(ep, page, SEAT);

			await clickModeToggle(page, mode);
			await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);

			await clickModeToggle(page, mode);
			await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
			expect((await focusPoint(ep))?.path).toEqual(PROSE);
		});
	}
});
