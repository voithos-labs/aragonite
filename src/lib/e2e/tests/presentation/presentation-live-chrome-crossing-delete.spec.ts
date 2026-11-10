import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { clickWordSettled, landAt } from './helpers';

// A delete from inside a bold run out of a callout takes the run's closing delimiter, so without
// the cleanup a literal `**` paints; with it the bold closes on the half that stays.
// Requirements: e2e/requirements/presentation/presentation-live-chrome-crossing-delete.md.

const CALLOUT = ':::callout Title\nSome **bold** text\n:::\n\n';
const FENCE = '```\ncode\n```\n';

/** The callout above `below` in live mode, the caret inside `bold` at raw offset 9. */
async function caretInBold(page: Page, below: string): Promise<PluginsPage> {
	const ep = new PluginsPage(page);
	await ep.gotoPlugins();
	await ep.loadContent(CALLOUT + below);
	await ep.setPresentationMode('live');
	await clickWordSettled(ep, page, 'bold');
	await landAt(ep, page, 9);
	return ep;
}

test('Backspace over a selection from inside bold to the paragraph below joins it behind the closed bold', async ({
	page
}) => {
	const ep = await caretInBold(page, 'Below\n');
	// Two keypresses: the first extends to the body's end, the second crosses out of the callout.
	await page.keyboard.press('Shift+ArrowDown');
	await ep.waitForRenderFlush();
	await page.keyboard.press('Shift+ArrowDown');
	const below = { focus: { path: [1], offset: 0 } };
	await expect.poll(() => ep.bridge.getSelectionPaths()).toMatchObject(below);
	await page.keyboard.press('Backspace');
	await expect.poll(() => ep.bridge.getSource()).toBe(':::callout Title\nSome **bo**Below\n:::\n');
	await expect(ep.editorContainer).toContainText('Some boBelow', { useInnerText: true });
});

test('Backspace over a selection from inside bold into a code block closes the bold on the half that stays', async ({
	page
}) => {
	const ep = await caretInBold(page, FENCE);
	await ep.shiftClickBlock([1], '```\nco'.length);
	// A click picks either side of a glyph, so the code the range leaves is read off where it landed.
	const { focus } = (await ep.bridge.getSelectionPaths())!;
	expect(focus.path).toEqual([1]);
	expect(focus.offset).toBeGreaterThan('```\n'.length);
	expect(focus.offset).toBeLessThan('```\ncode'.length);
	await page.keyboard.press('Backspace');
	// A code block's text joins no prose, so the body paragraph is cut where it stands.
	await expect
		.poll(() => ep.bridge.getSource())
		.toBe(`:::callout Title\nSome **bo**\n:::\n\n\`\`\`\n${FENCE.slice(focus.offset)}`);
	await expect(ep.editorContainer).toContainText('Some bo', { useInnerText: true });
});
