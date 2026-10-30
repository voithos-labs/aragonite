import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

// preview-block containment inside a plugin container: a focused body block shows its own
// inline markers, and the opener line's `:::foo` shows only when the caret is on that line.
// Requirements: e2e/requirements/presentation/presentation-directive-containment.md.

const DOC = ':::foo\nBody with **bold** here.\n:::\n';

test.describe('preview-block: directive-body containment', () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins();
		await ep.loadContent(DOC);
		await ep.setPresentationMode('preview-block');
		await ep.waitForRenderFlush();
	});

	test("focusing the body reveals its own markers but never the opener line's", async ({
		page
	}) => {
		const openerMarker = page.locator('.directive-opener-line .md-marker');
		const body = page.locator('.directive-block [contenteditable="true"]', {
			hasText: /bold/
		});
		const bodyMarker = body.locator('.md-marker').first();

		// Nothing focused: both the opener line's marker and the body's inline markers are hidden.
		await expect(openerMarker).toBeHidden();
		await expect(bodyMarker).toBeHidden();

		// Focus the body block: its `**` shows, since the block under the caret shows its source...
		await body.click();
		await expect(bodyMarker).toBeVisible();
		// ...but the opener line's `:::foo` stays hidden: it belongs to another block.
		await expect(openerMarker).toBeHidden();
	});

	test("the caret on the opener line shows that line's own source", async ({ page }) => {
		const openerMarker = page.locator('.directive-opener-line .md-marker');
		const bodyMarker = page.locator('.directive-block .md-marker').last();

		await ep.focusBlockAtPath([0, 0], 6);
		await expect(openerMarker).toBeVisible();
		await expect(bodyMarker).toBeHidden();
	});
});
