import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { clickBlockSettled, enterPresentationMode } from './helpers';

// The flip family's byte-stability contract, now including live: a mode change is CSS over
// the one render path, so no flip may move a byte.
// Requirements: e2e/requirements/presentation/presentation-live-mode-flips.md.

const DOC = [
	'# Title',
	'',
	'Some **bold** and [docs][ref] text',
	'',
	'- item one',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'| a | b |',
	'| --- | --- |',
	'| 1 | 2 |',
	'',
	'[ref]: https://example.com/docs'
].join('\n');

const PROSE = 1;

const RUNGS = [
	['reading', 'presentation-toggle'],
	['preview-block', 'preview-block-toggle'],
	['preview-inline', 'preview-inline-toggle'],
	['live', 'live-toggle']
] as const;

/** Click a rung's toggle on, then off — the demo's toggles switch between that mode and source. */
async function flipThrough(
	ep: EditorPage,
	page: Page,
	mode: string,
	testid: string
): Promise<void> {
	await page.getByTestId(testid).click();
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
	await ep.waitForRenderFlush();
	await page.getByTestId(testid).click();
	await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	await ep.waitForRenderFlush();
}

test.describe('mode flips — the bytes never move', () => {
	test('a round trip through every rung leaves the source byte-identical', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		const baseline = await ep.bridge.getSource();

		for (const [mode, testid] of RUNGS) {
			await flipThrough(ep, page, mode, testid);
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource(), `after ${mode}`).toBe(baseline);
		}
	});

	test('an edit typed in live survives every later flip', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickBlockSettled(ep, PROSE);
		await page.keyboard.press('End');
		await page.keyboard.type('EDIT');
		await ep.bridge.waitForSourceContains('EDIT');

		// Leave live, then take the document through the other three rungs and back.
		await page.getByTestId('live-toggle').click();
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		const edited = await ep.bridge.getSource();

		for (const [mode, testid] of RUNGS.filter(([m]) => m !== 'live')) {
			await flipThrough(ep, page, mode, testid);
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource(), `after ${mode}`).toBe(edited);
		}
	});

	// A pending mark is live-only ephemeral state, and a mode change is one of its declared
	// clears — a flip that materialized it would leave an invisible `****` behind.
	test('a mark pending at the caret writes nothing across a flip', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		const baseline = await ep.bridge.getSource();
		await clickBlockSettled(ep, PROSE);
		await page.keyboard.press('End');
		await page.keyboard.press(`${primaryModifier}+b`);
		await ep.waitForRenderFlush();

		await page.getByTestId('live-toggle').click();
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await flipThrough(ep, page, 'live', 'live-toggle');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
	});
});
