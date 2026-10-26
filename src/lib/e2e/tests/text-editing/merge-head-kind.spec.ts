import { test, expect } from '../../fixtures';
import { enterPresentationMode, focusOffset, focusPath } from '../presentation/helpers';

// A write that makes its block merge with the line below into another kind draws the new kind
// with the caret where the write left it (`requirements/text-editing/merge-head-kind.md`).

const DOC = '## a\n===\n';

test('a write merged into a setext heading draws the heading, caret in place', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'source', DOC);
	const host = page.locator(`[data-block-path='[0]']`);
	await expect(host).toHaveAttribute('data-block-kind', 'heading');
	await expect(host.getByRole('textbox')).toHaveAccessibleName('Heading level 2');
	await ep.focusBlockAtPath([0], 2);
	await ep.waitForRenderFlush();

	await page.keyboard.press('Delete');
	await ep.bridge.waitForSourceEquals('##a\n===\n');
	await ep.waitForBlockHostCount(1);

	await expect(host).toHaveAttribute('data-block-kind', 'setextHeading');
	await expect(host.getByRole('textbox')).toHaveAccessibleName('Heading level 1');
	expect(await focusPath(ep)).toEqual([0]);
	expect(await focusOffset(ep)).toBe(2);

	await ep.undo();
	await ep.bridge.waitForSourceEquals(DOC);
	await expect(host).toHaveAttribute('data-block-kind', 'heading');
});
