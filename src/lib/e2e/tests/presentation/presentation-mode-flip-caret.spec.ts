import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode, landAt } from './helpers';
import { clickModeToggle } from '../../mode-switch';

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
