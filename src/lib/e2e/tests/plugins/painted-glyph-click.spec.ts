import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { textRunStart } from '../../text-runs';

/**
 * A click on a painted glyph reports that glyph's raw offset
 * (requirements/plugins/painted-glyph-click.md). Each aim is read off the painted text alone, so
 * a wrong count in the editor's DOM-to-raw walk (the list marker's length, a widget's byte length,
 * a hidden marker's length) moves the reported offset instead of moving the aim along with it.
 */

const DOC = '- alpha beta\n\nMood :smile: today\n\nSome **bold** text\n';

const CASES = [
	{ glyph: "a list item's second letter", needle: 'lpha', path: [0, 0, 0], offset: 1, live: false },
	{ glyph: 'the first word past an emoji', needle: 'today', path: [1], offset: 13, live: false },
	{ glyph: 'bold text inside hidden markers', needle: 'ld', path: [2], offset: 9, live: true }
];

test.describe('a click on a painted glyph reports its raw offset', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('emoji');
		await editor.loadContent(DOC);
		await expect(page.locator("[data-block-path='[1]'] .md-emoji-widget")).toHaveCount(1);
	});

	for (const { glyph, needle, path, offset, live } of CASES) {
		test(`a click on ${glyph} reports offset ${offset}`, async ({ page }) => {
			if (live) {
				await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
				await expect(page.locator("[data-block-path='[2]'] .md-marker").first()).toBeHidden();
			}
			const point = await textRunStart(page, needle, { path });
			await page.mouse.click(point.x, point.y);

			const caret = { path, offset };
			await expect
				.poll(() => editor.bridge.getSelectionPaths())
				.toEqual({ anchor: caret, focus: caret });
		});
	}
});
