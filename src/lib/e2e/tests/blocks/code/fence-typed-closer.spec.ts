import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// A closer typed into an open fence one backtick at a time closes the fence with exactly the bytes
// typed: the write reads each keystroke as the user typing the block's syntax, never as content
// whose fence the rule would grow.
// Requirements: e2e/requirements/blocks/code/fence-typed-closer.md.

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: typing the closer of an open fence`, () => {
		test('each backtick lands as typed and the third closes the block', async ({ page }) => {
			const ep = new EditorPage(page);
			await ep.goto(mode === 'live' ? '?presentationMode=live' : '');
			await ep.loadContent('```js\ncode\n');
			// Raw offset 10: the end of the body, where Enter opens the line the closer goes on.
			await ep.focusBlockAtPath([0], 10);
			await page.keyboard.press('Enter');
			await ep.bridge.waitForSourceContains('code\n\n');

			await ep.typeSlowly('`');
			await ep.bridge.waitForSourceContains('code\n`');
			await ep.typeSlowly('`');
			await ep.bridge.waitForSourceContains('code\n``');
			await ep.typeSlowly('`');

			await expect.poll(() => ep.bridge.getSource()).toMatch(/^```js\ncode\n```\n/);
			expect(await ep.bridge.getBlockKind(0)).toBe('fencedCode');
		});
	});
}
