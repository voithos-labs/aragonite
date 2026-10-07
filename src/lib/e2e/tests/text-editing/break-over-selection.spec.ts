import { test, expect } from '../../fixtures';
import { enterPresentationMode } from '../presentation/helpers';

// Each row selects two characters with Shift+ArrowRight from `at`, then presses `key`.
const ROWS = [
	['a paragraph', 'alpha\n\nnext\n', [0], 1, 'Enter', 'a\n\nha\n\nnext\n'],
	['a paragraph', 'alpha\n\nnext\n', [0], 1, 'Shift+Enter', 'a\\\nha\n\nnext\n'],
	['a heading', '# alpha\n\nnext\n', [0], 3, 'Enter', '# a\nha\n\nnext\n'],
	['a heading', '# alpha\n\nnext\n', [0], 3, 'Shift+Enter', '# a\\\nha\n\nnext\n'],
	['a code block', '```\nalpha\n```\n\nnext\n', [0], 5, 'Enter', '```\na\nha\n```\n\nnext\n'],
	['a code block', '```\nalpha\n```\n\nnext\n', [0], 5, 'Shift+Enter', '```\na\nha\n```\n\nnext\n'],
	[
		'a table cell',
		'| a |\n| - |\n| alpha |\n\nnext\n',
		[0, 1, 0],
		1,
		'Shift+Enter',
		'| a |\n| - |\n| a<br>ha |\n\nnext\n'
	],
	[
		'a table cell',
		'| a |\n| - |\n| alpha |\n\nnext\n',
		[0, 1, 0],
		1,
		'Enter',
		'| a |\n| - |\n| alpha |\n|  |\n\nnext\n'
	]
] as const;

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: a break key over a selection in one block`, () => {
		for (const [where, doc, path, at, key, written] of ROWS) {
			test(`${key} in ${where}`, async ({ page }) => {
				const ep = await enterPresentationMode(page, mode, doc);
				await ep.focusBlockAtPath([...path], at);
				await page.keyboard.press('Shift+ArrowRight');
				await page.keyboard.press('Shift+ArrowRight');

				await page.keyboard.press(key);

				await ep.bridge.waitForSourceEquals(written);
			});
		}

		// The selection runs to the line's end, so the removal leaves the line empty.
		for (const [where, doc, path, at, written] of [
			['a list item', '- alpha\n\nnext\n', [0, 0, 0], 0, '- \n- \n\nnext\n'],
			[
				'a code block’s last line',
				'```\nfoo\nbar\n```\n\nnext\n',
				[0],
				8,
				'```\nfoo\n\n\n```\n\nnext\n'
			]
		] as const) {
			test(`Enter over the whole of ${where} splits and stays in the block`, async ({ page }) => {
				const ep = await enterPresentationMode(page, mode, doc);
				await ep.focusBlockAtPath([...path], at);
				await page.keyboard.press('Shift+End');

				await page.keyboard.press('Enter');

				await ep.bridge.waitForSourceEquals(written);
				expect((await ep.bridge.getSelection())?.focus.path).toEqual(
					path.length > 1 ? [0, 1, 0] : [0]
				);
			});
		}

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
