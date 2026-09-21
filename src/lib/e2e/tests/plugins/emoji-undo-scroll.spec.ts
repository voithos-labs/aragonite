import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from './helpers';

/**
 * Deleting a glyph widget and undoing it is an edit to one block, so the scroll container must not
 * move. Switching into live matters: it drops every measured height, and the undo's document swap
 * is the next thing to rebuild the height table from what is left.
 * Requirements: e2e/requirements/plugins/emoji-undo-scroll.md.
 */

const filler = (tag: string) =>
	Array.from(
		{ length: 40 },
		(_, i) => `Paragraph ${tag}${i} of filler text that wraps a little in a narrow column.`
	).join('\n\n');

const DOC = `${filler('a')}

## Punishing Evil

> [!WARNING]
> :crescent_moon:In the name of the Moon, I'll punish you!:punch:

1. Fighting evil by moonlight:full_moon:,
2. winning :two_hearts:love by :sunny:daylight,
3. never running from a real fight:muscle:,
4. she is the one named Sailor Moon! :dizzy::dizzy::dizzy::sparkles:

${filler('b')}
`;

const SUNNY = '☀️';

/** Where the user is: the scroll number, plus the block their eyes are on. */
async function viewport(page: Page): Promise<{ scrollTop: number; lead: string | null }> {
	return page.evaluate(() => {
		const port = document.querySelector('.editor') as HTMLElement;
		const portTop = port.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('.editor [data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		for (const host of hosts) {
			if (host.getBoundingClientRect().bottom > portTop + 1)
				return { scrollTop: port.scrollTop, lead: host.getAttribute('data-block-path') };
		}
		return { scrollTop: port.scrollTop, lead: null };
	});
}

test.describe('an undo that restores a glyph widget leaves the scrollport alone', () => {
	// Two positions for the shortcode's own list, below the fold and in view: re-estimating the
	// whole document slides the user by its accumulated error either way, and how far depends on
	// how much of the document sits above them.
	for (const offset of [-40, 80]) {
		test(`the list ${offset < 0 ? 'below the fold' : 'in view'} holds through delete + undo`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('emoji');
			await editor.loadContent(DOC);
			// A real mode change, not a mode set at load: the change is what drops the heights.
			await editor.setPresentationMode('live');

			const listIndex = await page.evaluate(() =>
				(window as any).__test
					.getDocument()
					.children.findIndex((c: { kind: string }) => c.kind === 'list')
			);
			const listTop = await page.evaluate((i) => {
				const port = document.querySelector('.editor') as HTMLElement;
				const el = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement;
				return el.getBoundingClientRect().top - port.getBoundingClientRect().top;
			}, listIndex);
			await editor.scrollEditorTo(listTop - 100 + offset);

			// Clicking the glyph's right half puts the caret at its trailing edge, where one
			// Backspace takes the whole shortcode.
			const box = await page.locator('.md-emoji-widget', { hasText: SUNNY }).first().boundingBox();
			if (!box) throw new Error('the sunny glyph is not on screen');
			await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
			await editor.waitForRenderFlush();
			const parked = await viewport(page);

			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSource((s: string) => !s.includes(':sunny:'));
			await editor.waitForRenderFlush();
			expect(await viewport(page), 'the delete left the reader alone').toEqual(parked);

			await editor.waitForUndoBatchFlush();
			await editor.undo();
			await editor.bridge.waitForSourceContains(':sunny:');
			await editor.waitForRenderFlush();
			expect(await viewport(page), 'and so did the undo').toEqual(parked);
		});
	}
});
