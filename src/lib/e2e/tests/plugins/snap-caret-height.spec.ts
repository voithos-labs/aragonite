import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// The caret the editor draws beside a text-height widget against the browser's own caret in the
// same paragraph (`requirements/plugins/snap-caret-height.md`), on the emoji seed so an emoji is
// a real rendered widget.

/** The drawn caret's box and the browser's caret box at a prose offset in the same paragraph. */
function caretBoxes(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const shell = document.querySelector<HTMLElement>('.md-snap-after, .md-snap-before');
		if (!shell) return null;
		const before = getComputedStyle(shell, '::before');
		const drawnTop = shell.getBoundingClientRect().top + parseFloat(before.top);
		const surface = shell.closest('[contenteditable="true"]')!;
		const prose = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT).nextNode() as Text;
		const range = document.createRange();
		range.setStart(prose, 1);
		const native = range.getClientRects()[0];
		return {
			drawn: { top: drawnTop, height: parseFloat(before.height) },
			native: { top: native.top, height: native.height }
		};
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
			const widget = (await page.locator('[data-inline-widget]').boundingBox())!;
			await page.mouse.click(widget.x + widget.width + 30, widget.y + widget.height / 2);
			await expect(page.locator('[data-inline-widget].md-snap-after')).toHaveCount(1);

			const boxes = (await caretBoxes(page))!;
			// Relative to the measured native caret, so the check holds on any font.
			const tolerance = boxes.native.height * 0.15;
			expect(Math.abs(boxes.drawn.height - boxes.native.height)).toBeLessThanOrEqual(tolerance);
			expect(Math.abs(boxes.drawn.top - boxes.native.top)).toBeLessThanOrEqual(tolerance);
		});
	}
});
