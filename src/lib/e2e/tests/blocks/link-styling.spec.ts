import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Link affordance + layout, all of which only surface under real layout/CSS
// (jsdom has no computed cursor, no `:has()`, no element box geometry):
//   - an inline link reads as a link (accent colour + underline), distinct from
//     body text and matching the autolink treatment;
//   - the pointer cursor appears only while Ctrl/Cmd is held, because a plain
//     click edits and only a modifier-click activates the link;
//   - an image wrapped in a link hugs the image instead of ballooning the anchor
//     to the full content width (which parked the link's `title` tooltip over
//     empty space beside the image);
//   - a blocked-scheme link stays inert: no anchor, no accent, no pointer.
test.describe('link styling + affordance', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('an inline link reads as a link: underlined, accent colour, distinct from body text', async ({
		page
	}) => {
		await editor.loadContent(
			'Visit [Example](https://example.com) and https://auto.example.com here.\n'
		);
		const link = page.locator('a.md-link-content', { hasText: 'Example' });
		await expect(link).toHaveCount(1);

		// Underlined like a link, not plain prose.
		await expect(link).toHaveCSS('text-decoration-line', 'underline');

		// "Is the accent, non-default" without pinning a hex: the link resolves the
		// same `--color-accent` token the autolink does, and both differ from the
		// inherited body-text colour. Comparing tokens survives a theme change.
		const linkColor = await link.evaluate((el) => getComputedStyle(el).color);
		const autoColor = await page
			.locator('a.md-autolink', { hasText: 'auto.example.com' })
			.evaluate((el) => getComputedStyle(el).color);
		const bodyColor = await editor.getBlock(0).evaluate((el) => getComputedStyle(el).color);

		expect(linkColor).toBe(autoColor);
		expect(linkColor).not.toBe(bodyColor);
	});

	test('links and autolinks show a pointer cursor only while Ctrl is held', async ({ page }) => {
		await editor.loadContent(
			'Visit [Example](https://example.com) and https://auto.example.com here.\n'
		);
		const link = page.locator('a.md-link-content', { hasText: 'Example' });
		const autolink = page.locator('a.md-autolink', { hasText: 'auto.example.com' });

		// Default: a plain click edits, so both keep the text caret (not the UA
		// `<a href>` pointer).
		await expect(link).toHaveCSS('cursor', 'text');
		await expect(autolink).toHaveCSS('cursor', 'text');

		await editor.focusBlockEnd(0);
		await page.keyboard.down('Control');
		await expect(editor.editorContainer).toHaveAttribute('data-mod-active', '');
		await expect(link).toHaveCSS('cursor', 'pointer');
		await expect(autolink).toHaveCSS('cursor', 'pointer');

		await page.keyboard.up('Control');
		await expect(editor.editorContainer).not.toHaveAttribute('data-mod-active', '');
		await expect(link).toHaveCSS('cursor', 'text');
		await expect(autolink).toHaveCSS('cursor', 'text');
	});

	test('the modifier cursor does not stick when the modifier is released unfocused', async ({
		page
	}) => {
		await editor.loadContent('Visit [Example](https://example.com) here.\n');
		const link = page.locator('a.md-link-content', { hasText: 'Example' });

		await editor.focusBlockEnd(0);
		await page.keyboard.down('Control');
		await expect(editor.editorContainer).toHaveAttribute('data-mod-active', '');

		// Simulate the page losing focus while the modifier is still physically
		// down (e.g. an OS shortcut / alt-tab). The keyup never reaches us, so the
		// blur/visibility reset must clear the pointer affordance on its own.
		await page.evaluate(() => {
			window.dispatchEvent(new Event('blur'));
		});
		await expect(editor.editorContainer).not.toHaveAttribute('data-mod-active', '');
		await expect(link).toHaveCSS('cursor', 'text');

		await page.keyboard.up('Control');
	});

	test('an image wrapped in a link hugs the image, not the full content width', async ({
		page
	}) => {
		// `[shot]` resolves the inner image, `[repo]` the outer link; the title on
		// the `[repo]` LRD is what produced the over-wide `title` tooltip pre-fix.
		const NESTED = [
			'[![cat][shot]][repo]',
			'',
			'[shot]: /test-fixtures/sample.png',
			'[repo]: https://example.com "Repository"',
			''
		].join('\n');
		await editor.loadContent(NESTED);

		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
		const img = widget.locator('img');

		// Measuring before the bitmap decodes would compare two ~0px boxes and pass
		// vacuously; wait for a real intrinsic size first.
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
			.toBeGreaterThan(0);

		const anchor = page.locator('a.md-link-content');
		await expect(anchor).toHaveCount(1);
		const anchorBox = await anchor.boundingBox();
		const imgBox = await img.boundingBox();
		expect(anchorBox).not.toBeNull();
		expect(imgBox).not.toBeNull();
		expect(imgBox!.width).toBeGreaterThan(0);

		// The anchor hugs the image (within a couple of sub-pixel rounding px)…
		expect(Math.abs(anchorBox!.width - imgBox!.width)).toBeLessThanOrEqual(3);
		// …and is far narrower than the editing surface — the bug ballooned it to
		// the full content width (~1246px around a 32px image).
		const contentWidth = await editor.editorContainer.evaluate((el) => el.clientWidth);
		expect(anchorBox!.width).toBeLessThan(contentWidth / 2);
	});

	test('a blocked-scheme link renders inert and is not styled as clickable', async ({ page }) => {
		await editor.loadContent(
			'Real [Example](https://example.com) and blocked [x](javascript:alert(1)) here.\n'
		);

		// Only the real link is an anchor; the blocked one is an inert span.
		await expect(page.locator('a.md-link-content')).toHaveCount(1);
		const blocked = page.locator('span.md-link-blocked', { hasText: 'x' });
		await expect(blocked).toHaveCount(1);

		// Not underlined, not a pointer — visually inert.
		await expect(blocked).toHaveCSS('text-decoration-line', 'none');
		await expect(blocked).toHaveCSS('cursor', 'text');

		// And not the accent colour the real link uses.
		const blockedColor = await blocked.evaluate((el) => getComputedStyle(el).color);
		const realColor = await page
			.locator('a.md-link-content', { hasText: 'Example' })
			.evaluate((el) => getComputedStyle(el).color);
		expect(blockedColor).not.toBe(realColor);

		// Holding the modifier must not turn the blocked span into a pointer.
		await editor.focusBlockEnd(0);
		await page.keyboard.down('Control');
		await expect(editor.editorContainer).toHaveAttribute('data-mod-active', '');
		await expect(blocked).toHaveCSS('cursor', 'text');
		await page.keyboard.up('Control');
	});
});
