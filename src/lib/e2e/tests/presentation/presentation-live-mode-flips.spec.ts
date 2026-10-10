import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode } from './helpers';
import { clickModeToggle, type ToggledMode } from '../../mode-switch';

// Byte stability across every mode, live included: a mode switch is CSS over the one render path,
// so it may never move a byte.
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

const MODES = ['reading', 'preview-block', 'preview-inline', 'live'] as const;

/** Click a mode's toggle on, then off; the demo's toggles switch between that mode and source. */
async function flipThrough(ep: EditorPage, page: Page, mode: ToggledMode): Promise<void> {
	await clickModeToggle(page, mode);
	await ep.waitForRenderFlush();
	await clickModeToggle(page, mode);
	await ep.waitForRenderFlush();
}

test.describe('mode flips: the bytes never move', () => {
	test('a round trip through every inline syntax handler leaves the source byte-identical', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		const baseline = await ep.bridge.getSource();

		for (const mode of MODES) {
			await flipThrough(ep, page, mode);
			// A toggle click, not a keystroke.
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

		// Leave live, then take the document through the other three modes and back.
		await clickModeToggle(page, 'live');
		const edited = await ep.bridge.getSource();

		for (const mode of MODES.filter((m) => m !== 'live')) {
			await flipThrough(ep, page, mode);
			// A toggle click, not a keystroke.
			await ep.waitForNoSourceMutation();
			expect(await ep.bridge.getSource(), `after ${mode}`).toBe(edited);
		}
	});

	// A pending mark is live-only temporary state that a mode change clears; a mode switch that
	// wrote it out would leave an invisible `****` behind.
	test('a mark pending at the caret writes nothing across a flip', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		const baseline = await ep.bridge.getSource();
		await clickBlockSettled(ep, PROSE);
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+b');
		await ep.waitForRenderFlush();

		await clickModeToggle(page, 'live');
		await flipThrough(ep, page, 'live');
		// A toggle click, not a keystroke.
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
	});
});
