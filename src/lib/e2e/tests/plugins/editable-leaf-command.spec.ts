import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, capturedErrors } from './helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * Minted block commands on the editable-leaf tier (requirements/plugins/editable-leaf-command.md):
 * the `%%` memo harness kind binds two commands on its keymap — `memo.tag` (Mod+Shift+K, commits
 * metadata) and `memo.boom` (Mod+Shift+J, throws). Proves a minted `(kind, id)` command resolves on
 * the leaf path through the real `createEditableLeaf` factory, and that a handler throw is
 * contained and surfaced as an `origin: 'command'` error rather than escaping.
 */

class MemoPage extends PluginsPage {
	get memo() {
		return this.page.locator('.memo-block');
	}

	async gotoSeed(): Promise<void> {
		await this.gotoPlugins('memo');
		await expect(this.memo).toHaveCount(1);
	}
}

test.describe('minted block commands on the editable-leaf tier: the %% memo kind', () => {
	let editor: MemoPage;

	test.beforeEach(async ({ page }) => {
		editor = new MemoPage(page);
		await editor.gotoSeed();
	});

	test('a bound minted command fires on the leaf and commits through the metadata route', async ({
		page
	}) => {
		await editor.memo.click();
		await page.keyboard.press('ControlOrMeta+Shift+K');

		// The handler's `updateMetadata` lands on the focused memo node (index 1).
		await page.waitForFunction(
			() => (window as any).__test.getDocument().children[1]?.metadata?.memoTagged === true,
			null,
			{ timeout: 2000 }
		);
		// Memo metadata is not raw-bearing, so the source round-trips unchanged.
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a throwing handler is contained: one origin:command error, no uncaught pageerror', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);
		await page.evaluate(() => (window as any).__test.startErrorCapture());

		await editor.memo.click();
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+Shift+J');

		await page.waitForFunction(
			() => (window as any).__test.getCapturedErrors().includes('command'),
			null,
			{ timeout: 2000 }
		);
		const origins = await capturedErrors(page);
		expect(origins.filter((o) => o === 'command')).toHaveLength(1);
		expect(pageErrors).toEqual([]);

		// The gesture was a no-op that consumed the key; the editor stays interactive.
		await page.keyboard.type('!');
		await editor.bridge.waitForSourceContains('%% memo text!');
	});
});
