import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage, roundTripStable, waitForDoc, activeBlockPath } from './helpers';

/**
 * Plain-mode editable leaf (requirements/plugins/editable-leaf-plain.md): the `%%` memo harness
 * kind proves `createEditableLeaf({ mode: 'plain' })` gives a plugin leaf built-in-text-block
 * parity — typing, traversal, undo batching, cross-block selection, and clipboard — through the
 * public factory alone.
 */

const readClipboard = (page: Page): Promise<string> =>
	page.evaluate(() => navigator.clipboard.readText());

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

	test('a single-block paste is intercepted: HTML is stripped and newlines survive', async ({
		page
	}) => {
		await editor.memo.click();
		await page.keyboard.press('End');
		await page.evaluate(async () => {
			await navigator.clipboard.write([
				new ClipboardItem({
					'text/plain': new Blob(['a\nb'], { type: 'text/plain' }),
					'text/html': new Blob(['<b>a</b><br><i>b</i>'], { type: 'text/html' })
				})
			]);
		});
		await page.keyboard.press('Control+v');

		// The text/plain payload lands verbatim — its newline re-splits the second line off as a
		// paragraph, so the document carries `a\nb`. Without the leaf's own onpaste the native
		// paste drops HTML markup into the block and the per-keystroke commit joins the lines.
		await editor.bridge.waitForSourceContains('%% memo texta\nb');
		const html = await page.evaluate(() => document.querySelector('.memo-block')?.innerHTML ?? '');
		expect(html).not.toContain('<b>');
		expect(html).not.toContain('<i>');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('cross-block copy anchored in the memo reaches the shared collector', async ({ page }) => {
		await editor.memo.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End'); // select the memo line (single-block, native)
		await page.keyboard.press('Shift+ArrowDown'); // extend into After → cross-block
		await editor.waitForCrossBlock(true);
		await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
		await page.keyboard.press('Control+c');

		// The memo (leaf) is the focused anchor: its copy handler must reach the shared cross-block
		// collector, which reads the memo's own raw. Without one the clipboard keeps the sentinel.
		await expect.poll(() => readClipboard(page)).toContain('memo text');
	});

	test('cross-block cut anchored in the memo writes the payload and collapses the range', async ({
		page
	}) => {
		await editor.memo.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
		await page.keyboard.press('Control+x');

		// The leaf's cut handler writes the cross-block payload and deletes the swept range; with
		// no handler reached, the clipboard keeps the sentinel and nothing is removed.
		await expect.poll(() => readClipboard(page)).toContain('memo text');
		await editor.waitForCrossBlock(false);
		expect(await roundTripStable(page)).toBe(true);
	});

	// memo registers no paste surface, so the dispatch takes the default hooks and says so;
	// the declaration is what makes the fallthrough an asserted path rather than a shrug.
	test.describe('paste over a cross-block selection anchored in the memo', () => {
		test.use({ expectWarns: ['paste-dispatch'] });

		test('clears it and lands the text', async ({ page }) => {
			await editor.memo.click();
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			await page.evaluate(() => navigator.clipboard.writeText('INSERTED'));
			await page.keyboard.press('Control+v');

			// The leaf's paste handler routes the swept range through the cross-block delete + paste,
			// so the selection collapses and the text lands; unreached, the cross-block state sticks.
			await editor.waitForCrossBlock(false);
			await editor.bridge.waitForSourceContains('INSERTED');
			expect(await roundTripStable(page)).toBe(true);
		});
	});
});
