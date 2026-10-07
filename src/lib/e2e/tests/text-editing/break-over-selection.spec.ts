import { test, expect } from '../../fixtures';
import { enterPresentationMode, nextRow } from '../presentation/helpers';

// The browser turns Shift+Enter into an input event no key handler sees, so these two rows need a
// real browser. Every other break key is pinned in `break-over-selection.test.ts`.
const NATIVE_ROWS = [
	['a code block', '```\nalpha\n```\n\nnext\n', [0], 5, '```\na\nha\n```\n\nnext\n'],
	[
		'a table cell',
		'| a |\n| - |\n| alpha |\n\nnext\n',
		[0, 1, 0],
		1,
		'| a |\n| - |\n| a<br>ha |\n\nnext\n'
	]
] as const;

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: a break key over a selection in one block`, () => {
		test('Shift+Enter over a selection in a code block and a table cell', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, NATIVE_ROWS[0][1]);
			for (const [i, [where, doc, path, at, written]] of NATIVE_ROWS.entries()) {
				await test.step(where, async () => {
					if (i > 0) await nextRow(ep, doc);
					await ep.focusBlockAtPath([...path], at);
					await page.keyboard.press('Shift+ArrowRight');
					await page.keyboard.press('Shift+ArrowRight');

					await page.keyboard.press('Shift+Enter');

					await ep.bridge.waitForSourceEquals(written);
				});
			}
		});

		test('one Ctrl+Z puts the selected text back, selected, and redo breaks it again', async ({
			page
		}) => {
			const doc = 'alpha\n\nnext\n';
			const ep = await enterPresentationMode(page, mode, doc);
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('Enter');
			await ep.bridge.waitForSourceEquals('a\n\nha\n\nnext\n');

			await ep.undo();
			await ep.bridge.waitForSourceEquals(doc);
			expect(await ep.bridge.getSelection()).toEqual({
				anchor: { path: [0], offset: 1 },
				focus: { path: [0], offset: 3 }
			});

			await ep.redo();
			await ep.bridge.waitForSourceEquals('a\n\nha\n\nnext\n');
		});

		test('typing after Enter over a selection lands at the start of the new line', async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, 'alpha\n\nnext\n');
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('Enter');
			await ep.bridge.waitForSourceEquals('a\n\nha\n\nnext\n');

			await ep.typeSlowly('x');

			await expect.poll(() => ep.bridge.getSource()).toBe('a\n\nxha\n\nnext\n');
		});
	});
}
