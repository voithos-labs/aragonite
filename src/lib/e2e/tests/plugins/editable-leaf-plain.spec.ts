import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable, waitForDoc, activeBlockPath } from './helpers';

/**
 * Plain-mode editable leaf (requirements/plugins/editable-leaf-plain.md): the
 * `%%` memo harness kind proves `createEditableLeaf({ mode: 'plain' })` gives a
 * plugin leaf built-in-text-block parity — typing, traversal, undo batching,
 * cross-block selection — through the public factory alone.
 * Seed: `Before` / `%% memo text` / `After`.
 */

class MemoPage extends PluginsPage {
	get memo() {
		return this.page.locator('.memo-block');
	}

	async gotoSeed(): Promise<void> {
		await this.gotoPlugins('memo');
		await expect(this.memo).toHaveCount(1);
		expect(await this.bridge.getBlockKind(1)).toBe('memo');
	}
}

test.describe('plain-mode editable leaf: the %% memo kind', () => {
	let editor: MemoPage;

	test.beforeEach(async ({ page }) => {
		editor = new MemoPage(page);
		await editor.gotoSeed();
	});

	test('typing commits per keystroke and round-trips', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press('End');
		await page.keyboard.type('!');

		await editor.bridge.waitForSourceContains('%% memo text!');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('arrows enter, cross, and exit the memo like a native block', async ({ page }) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([2]);

		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([1]);
		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([0]);
	});

	test('a typed burst undoes in one step (prose-like batching)', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' abc');
		await editor.bridge.waitForSourceContains('%% memo text abc');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('abc');
		expect(await editor.bridge.getSource()).toContain('%% memo text');
	});

	test('a cross-block selection sweeps through the memo', async ({ page }) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Shift+ArrowDown');

		await page.waitForFunction(() => {
			const paths = (window as unknown as Record<string, any>).__test.getSelectionPaths();
			return paths?.focus?.path?.[0] === 2;
		});
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths!.anchor.path).toEqual([0]);
		expect(paths!.focus.path).toEqual([2]);
	});

	test('Enter + text re-splits the memo through the commit kernel', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('tail');

		const doc = await waitForDoc(page, (s) => s.rootCount === 4);
		expect(doc.kinds).toEqual(['paragraph', 'memo', 'paragraph', 'paragraph']);
		expect(doc.texts[1]).toBe('%% memo text');
		expect(doc.texts[2]).toBe('tail');
		// The caret followed the edit into the split-off paragraph.
		expect(await activeBlockPath(page)).toEqual([2]);
		expect(await roundTripStable(page)).toBe(true);
	});
});
