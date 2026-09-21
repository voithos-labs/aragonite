import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, activeBlockPath } from './helpers';

/**
 * A plugin's editable leaf taking keystrokes under `live`
 * (requirements/plugins/editable-leaf-live.md). Only the mode differs; the expected bytes repeat
 * `editable-leaf-plain.spec.ts`'s on purpose, and the value is the fixture's console watch, where
 * any `[invariant:…]` warning fails the run.
 */

test.describe('plugin editable leaf under live mode: the %% memo kind', () => {
	test('arrowing into the memo and typing lands the bytes in the source', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('memo');
		await editor.setPresentationMode('live');

		// Enter by arrow, not by click: a click lets the browser place the caret, and only the
		// structural path reaches the leaf's own `parkCaret`.
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('End');
		await page.keyboard.type('!!');

		await editor.bridge.waitForSourceContains('%% memo text!!');
		expect(await roundTripStable(page)).toBe(true);
	});
});
