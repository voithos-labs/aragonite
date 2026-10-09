import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { drawnBar, expectBarAfterWidget } from '../../carets-showing';

// The caret the editor draws beside a text-height widget against the browser's own caret in the
// same paragraph (`requirements/plugins/snap-caret-height.md`), on the emoji seed so an emoji is
// a real rendered widget.

/** The browser's caret box at a prose offset in the paragraph the bar draws in. */
function proseCaretBox(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const surface = document.querySelector('[data-inline-widget]')!.closest('[contenteditable]')!;
		const prose = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT).nextNode() as Text;
		const range = document.createRange();
		range.setStart(prose, 1);
		const native = range.getClientRects()[0];
		return { top: native.top, height: native.height };
	});
}

test.describe('the drawn caret beside a text-height widget', () => {
	for (const { kind, source } of [
		{ kind: 'an emoji', source: 'Some prose on this line :tada:\n' },
		{ kind: 'a decoded entity', source: 'Some prose on this line &amp;\n' }
	]) {
		test(`beside ${kind} ending the line, it is the height of the native caret`, async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('emoji');
			await editor.loadContent(source);
			const widget = page.locator('[data-inline-widget]');
			const box = (await widget.boundingBox())!;
			await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
			await expectBarAfterWidget(page, widget, 'text-height');

			const drawn = (await drawnBar(page))!.box;
			const native = await proseCaretBox(page);
			// Relative to the measured native caret, so the check holds on any font.
			const tolerance = native.height * 0.15;
			expect(Math.abs(drawn.height - native.height)).toBeLessThanOrEqual(tolerance);
			expect(Math.abs(drawn.top - native.top)).toBeLessThanOrEqual(tolerance);
		});
	}
});
