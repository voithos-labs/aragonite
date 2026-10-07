import { test, expect } from '../../fixtures';
import { clickEnd, enterPresentationMode, keys, nextRow } from './helpers';

// The preview modes paint the focused block's markers, a code span's backticks included, so an
// arrow steps over each backtick like any byte and the caret's spot is the byte's. Each test walks
// its rows as steps, every step on a fresh copy of the document.
// Requirements: e2e/requirements/presentation/presentation-preview-code-span.md.

const PLACES = [
	['a paragraph', 'a `cee` q\n\ntail', 'a `cee`X q', 'a X`cee` q'],
	['a table cell', '| h | h2 |\n| - | - |\n| a `cee` q | z |', '| a `cee`X q |', '| a X`cee` q |']
] as const;

for (const mode of ['preview-block', 'preview-inline'] as const) {
	test(`${mode}: a code span in the focused block`, async ({ page }) => {
		const ep = await enterPresentationMode(page, mode, '\n');

		for (const [place, doc, past, before] of PLACES) {
			await test.step(`${place}: ArrowRight at its end types past the closing backtick`, async () => {
				await nextRow(ep, doc);
				await clickEnd(ep, page, 'cee');
				await expect(page.locator('code.inline-code-content + .md-marker')).toBeVisible();
				await keys(ep, page, 'ArrowRight');
				await page.keyboard.type('X');
				await ep.bridge.waitForSourceContains(past);
			});

			await test.step(`${place}: ArrowLeft at its start types before the opening backtick`, async () => {
				await nextRow(ep, doc);
				await clickEnd(ep, page, 'cee');
				await keys(ep, page, 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
				await page.keyboard.type('X');
				await ep.bridge.waitForSourceContains(before);
			});
		}
	});
}
