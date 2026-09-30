import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

// preview-block containment inside a plugin container: a focused body block shows its own
// inline markers, but the directive fences belong to the container and never show.
// Requirements: e2e/requirements/presentation/presentation-directive-containment.md.

const DOC = ':::foo\nBody with **bold** here.\n:::\n';

test.describe('preview-block: directive-body containment', () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins();
		await ep.loadContent(DOC);
		await page.evaluate(() => (window as any).__test.setPresentationMode('preview-block'));
		await ep.waitForRenderFlush();
	});

	test('focusing the body reveals its own markers but never the directive fences', async ({
		page
	}) => {
		const directiveMarker = page.locator('.directive-marker').first();
		const bodyMarker = page.locator('.directive-block .md-marker').first();
		const body = page.locator('.directive-block [contenteditable="true"]', {
			hasText: /bold/
		});

		// Nothing focused: both the fences and the body's inline markers are hidden.
		await expect(directiveMarker).toBeHidden();
		await expect(bodyMarker).toBeHidden();

		// Focus the body block: its `**` shows, since the block under the caret shows its source...
		await body.click();
		await expect(bodyMarker).toBeVisible();
		// ...but the container's `:::foo` fence stays hidden: it belongs to the container, not to
		// the focused block.
		await expect(directiveMarker).toBeHidden();
	});
});
