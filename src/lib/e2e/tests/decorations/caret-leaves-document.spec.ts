import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';

/**
 * A gesture that ends the document caret still reaches `selectionChange`
 * (requirements/decorations/caret-leaves-document.md). Miss-analysis: the channel was pinned
 * only through gestures that also move an editor-owned selection field, so the gestures whose
 * whole effect is on the NATIVE caret had no test at any level.
 */

const OCCURRENCE = '.decoration-overlay.hl-occurrence';

test('selecting an image widget clears the marks the caret was painting', async ({ page }) => {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('hloccur-memo');
	await editor.loadContent('alpha beta alpha\n\n![cat](/test-fixtures/sample.png)\n');
	await editor.clickBlockAtPath([0], 0);
	await expect(page.locator(OCCURRENCE)).toHaveCount(2);

	await page.locator('[data-image-widget]').first().click();

	await expect(page.locator('[data-image-overlay]')).toBeVisible();
	await expect(page.locator(OCCURRENCE)).toHaveCount(0);
});
