import { test, expect } from '../../fixtures';
import { clickWordSettled, enterPresentationMode, landAt } from './helpers';

// A delete that crosses into a table truncates its prose endpoint in place, with no join, so
// without the cleanup for unpaired runs the cut leaves a delimiter run on screen.
// Requirements: e2e/requirements/presentation/presentation-live-table-crossing-delete.md.

const DOC = 'Some **bold** text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

test('Backspace over a selection from inside bold into the table leaves no stranded run', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', DOC);
	await clickWordSettled(ep, page, 'bold');
	await landAt(ep, page, 9);

	// Two keypresses: the first extends to the block's end, the second crosses into the table.
	await page.keyboard.press('Shift+ArrowDown');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Shift+ArrowDown');
	await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);
	await page.keyboard.press('Backspace');
	await ep.bridge.waitForSourceContains('Some bo');

	const source = await ep.bridge.getSource();
	expect(source).not.toContain('**');
	expect(source).toContain('Some bo\n');
	await expect(ep.getBlock(0)).toHaveText('Some bo', { useInnerText: true });
});
