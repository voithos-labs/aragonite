import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { enterPresentationMode } from './helpers';
import { textRunEnd } from '../../text-runs';

// The preview modes paint the focused block's markers, a code span's backticks included, so an
// arrow steps over each backtick like any byte and the caret's spot is the byte's.
// Requirements: e2e/requirements/presentation/presentation-preview-code-span.md.

const PLACES = [
	['a paragraph', 'a `cee` q\n\ntail', 'a `cee`X q', 'a X`cee` q'],
	['a table cell', '| h | h2 |\n| - | - |\n| a `cee` q | z |', '| a `cee`X q |', '| a X`cee` q |']
] as const;

async function clickEndOfCee(ep: EditorPage, page: Page): Promise<void> {
	const end = await textRunEnd(page, 'cee');
	await page.mouse.click(end.x, end.y);
	await ep.waitForRenderFlush();
}

async function keys(ep: EditorPage, page: Page, ...pressed: string[]): Promise<void> {
	for (const key of pressed) {
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
}

for (const mode of ['preview-block', 'preview-inline'] as const) {
	test.describe(`${mode}: a code span in the focused block`, () => {
		for (const [place, doc, past, before] of PLACES) {
			test(`${place}: ArrowRight at its end types past the closing backtick`, async ({ page }) => {
				const ep = await enterPresentationMode(page, mode, doc);
				await clickEndOfCee(ep, page);
				await expect(page.locator('.md-code-fence').last()).toBeVisible();
				await keys(ep, page, 'ArrowRight');
				await page.keyboard.type('X');
				await ep.bridge.waitForSourceContains(past);
			});

			test(`${place}: ArrowLeft at its start types before the opening backtick`, async ({
				page
			}) => {
				const ep = await enterPresentationMode(page, mode, doc);
				await clickEndOfCee(ep, page);
				await keys(ep, page, 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
				await page.keyboard.type('X');
				await ep.bridge.waitForSourceContains(before);
			});
		}
	});
}
