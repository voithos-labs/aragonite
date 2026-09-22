import { test, expect } from '../../fixtures';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';
import { PluginsPage } from '../plugins/helpers';

// The open list is a listbox over the editor's own colours, and the block the author types in
// becomes a combobox naming it, so both halves get an axe pass the block alone never gave them.

test.describe('inline menu accessibility (axe baseline-ratchet)', () => {
	test('an open list has no new violations', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(2);
		await editor.typeText(' #');

		await expect(page.locator('[data-inline-menu]')).toBeVisible();
		await expect(page.locator('[role="combobox"]')).toHaveCount(1);
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'inline-menu');
	});
});
