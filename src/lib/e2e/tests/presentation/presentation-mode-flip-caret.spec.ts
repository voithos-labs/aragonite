import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { clickWordSettled, enterPresentationMode, landAt } from './helpers';

// The caret half of the flip family's contract (#109): a mode change moves no byte, so the
// seat the user had comes back on the other side — banked through reading, which has none.
// Requirements: e2e/requirements/presentation/presentation-mode-flip-caret.md.

const DOC = ['# Title', '', 'Some **bold** and more text'].join('\n');

const PROSE = [1];
// `Some **bo|ld**` — mid-construct, landable on every rung.
const SEAT = 9;

// A cell's raw is its own, so the same seat reads the same way inside the grid.
const TABLE_DOC = ['| Some **bold** cell | b |', '| --- | --- |', '| c | d |'].join('\n');
const CELL = [0, 0, 0];

async function focusPoint(ep: EditorPage): Promise<{ path: number[]; offset: number } | null> {
	return (await ep.bridge.getSelectionPaths())?.focus ?? null;
}

test.describe('mode flips — the caret comes back', () => {
	test('a caret mid-construct in live survives the flip to source and takes the next byte', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);

		await page.getByTestId('live-toggle').click();
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
		expect((await focusPoint(ep))?.path).toEqual(PROSE);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	test('the caret banked entering reading re-seats on the flip out', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);

		await page.getByTestId('presentation-toggle').click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSelectionPaths()).toBeNull();

		await page.getByTestId('presentation-toggle').click();
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	// A cell keys its rendered DOM on the mode (#39), so a flip rebuilds every mounted cell and
	// runs the capture/restore pair prose has always run — for a block that carries no
	// `data-block-path` of its own and reaches the caret three levels deep.
	test('a caret inside a table cell survives the flip and takes the next byte there', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', TABLE_DOC);
		await clickWordSettled(ep, page, 'bold');
		await landAt(ep, page, SEAT);
		expect((await focusPoint(ep))?.path).toEqual(CELL);

		await page.getByTestId('live-toggle').click();
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
		expect((await focusPoint(ep))?.path).toEqual(CELL);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boXld');
	});

	// Reading rides the test above — its inbound half has no caret to assert.
	const EDITABLE_RUNGS = [
		['preview-block', 'preview-block-toggle'],
		['preview-inline', 'preview-inline-toggle'],
		['live', 'live-toggle']
	] as const;

	for (const [mode, testid] of EDITABLE_RUNGS) {
		test(`a source caret survives the ${mode} round trip, re-seated on both flips`, async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, 'source', DOC);
			await clickWordSettled(ep, page, 'bold');
			await landAt(ep, page, SEAT);

			await page.getByTestId(testid).click();
			await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
			await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);

			await page.getByTestId(testid).click();
			await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
			await expect.poll(async () => (await focusPoint(ep))?.offset).toBe(SEAT);
			expect((await focusPoint(ep))?.path).toEqual(PROSE);
		});
	}
});
