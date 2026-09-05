import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { clickWordSettled, landAt } from './helpers';

// A chrome-crossing delete truncates its prose endpoints in place — no join — so without the
// cleaner's unpaired-run half the cut strands a delimiter run onto the screen.
// Requirements: e2e/requirements/presentation/presentation-live-chrome-crossing-delete.md.

const DOC = ':::callout Title\nSome **bold** text\n:::\n\nBelow\n';

test('Backspace over a selection from inside bold out of the callout leaves no stranded run', async ({
	page
}) => {
	const ep = new PluginsPage(page);
	await ep.gotoPlugins();
	await ep.loadContent(DOC);
	await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');

	await clickWordSettled(ep, page, 'bold');
	await landAt(ep, page, 9);

	// Two presses: the first extends natively to the body's end; the second crosses the wall.
	await page.keyboard.press('Shift+ArrowDown');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Shift+ArrowDown');
	await expect.poll(async () => (await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);
	await page.keyboard.press('Backspace');
	await ep.bridge.waitForSourceContains('Some bo');

	const source = await ep.bridge.getSource();
	expect(source).not.toContain('**');
	expect(source).toContain('Some bo\n');
	await expect(ep.editorContainer).toContainText('Some bo');
});
