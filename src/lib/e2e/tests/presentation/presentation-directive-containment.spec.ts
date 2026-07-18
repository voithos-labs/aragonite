import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

// preview-block containment across a plugin container: focusing a body leaf inside a
// `:::name` directive reveals that leaf's own inline markers, but the directive fences
// (`.directive-marker`) are container chrome and never reveal — they stay hidden.
// Runs on /test/plugins for the directive grammar. Requirements:
// e2e/requirements/presentation/presentation-directive-containment.md.

const DOC = ':::foo\nBody with **bold** here.\n:::\n';

test.describe('preview-block — directive-body containment', () => {
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

		// Nothing focused: both the fence chrome and the body's inline markers are hidden.
		await expect(directiveMarker).toBeHidden();
		await expect(bodyMarker).toBeHidden();

		// Focus the body leaf: its `**` reveals (source under the caret's block)...
		await body.click();
		await expect(bodyMarker).toBeVisible();
		// ...but the container's `:::foo` fence stays hidden — it belongs to the
		// container, not the focused leaf, so the no-reveal path holds.
		await expect(directiveMarker).toBeHidden();
	});
});
