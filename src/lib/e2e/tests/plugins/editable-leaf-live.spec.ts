import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, activeBlockPath } from './helpers';

/**
 * A plugin editable leaf taking keystrokes under `live` (requirements/plugins/editable-leaf-live.md).
 * The mode is the variable — the byte oracle repeats `editable-leaf-plain.spec.ts`'s on purpose —
 * and the regression value is the fixture's console watch: any `[invariant:…]` fire fails the run.
 */

test.describe('plugin editable leaf under live mode: the %% memo kind', () => {
	test('arrowing into the memo and typing lands the bytes in the source', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('memo');
		await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
		// An ineffective flip falls back to source, where every assertion below passes anyway.
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');

		// Arrow entry, not a click: a click seats the caret natively, and only the structural
		// route reaches the leaf's `parkCaret` door.
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('End');
		await page.keyboard.type('!!');

		await editor.bridge.waitForSourceContains('%% memo text!!');
		expect(await roundTripStable(page)).toBe(true);
	});
});
