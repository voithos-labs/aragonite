import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * A pick that waits before it writes: the author's typing in the meantime is its own undo entry.
 * Requirements: e2e/requirements/plugins/inline-menu-held-commit.md.
 */

/** `Type here`, the plain typing target. */
const TARGET = 2;

test.describe('an inline-menu pick that waits', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('typing while the pick waits is its own entry: three steps back', async () => {
		const before = await editor.bridge.getSource();
		await editor.typeText(' @ad');
		await expect(editor.page.locator('[data-inline-menu]')).toBeVisible();
		const typed = await editor.bridge.getSource();
		await editor.page.keyboard.press('Enter');
		await expect(editor.page.locator('[data-inline-menu]')).toHaveCount(0);
		await editor.typeText('xy');
		await editor.bridge.waitForSourceContains('Type here @adxy');
		const typedAfter = await editor.bridge.getSource();

		await editor.page.evaluate(() => window.__releaseHeldCommit?.());
		await editor.bridge.waitForSourceContains('Type here xy\n\n> card');
		await editor.waitForRenderFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(typedAfter);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(typed);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});
});

// The pick was made in one note; a host that loads another before the pick is released must
// find that note untouched, and must still be able to write into it itself.
test.describe('an inline-menu pick that waits across a source swap', () => {
	let editor: PluginsPage;
	const next = 'note b one\n\nnote b two\n';

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
		await editor.typeText(' @ad');
		await expect(editor.page.locator('[data-inline-menu]')).toBeVisible();
		await editor.page.keyboard.press('Enter');
		await expect(editor.page.locator('[data-inline-menu]')).toHaveCount(0);
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.bridge.waitForSourceEquals(next);
	});

	test('the released pick lands nowhere, even with a caret in the next note', async ({ page }) => {
		await editor.focusBlockEnd(1);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.evaluate(() => window.__releaseHeldCommit?.());
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(next);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
	});

	test('a host write made after the swap still lands', async ({ page }) => {
		await editor.focusBlockEnd(1);
		await page.evaluate(() => (window as any).__test.insertMarkdown('> host'));
		await editor.bridge.waitForSourceContains('> host');
		await page.evaluate(() => window.__releaseHeldCommit?.());
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toContain('> host');
		expect(await editor.bridge.getSource()).not.toContain('> card');
	});
});

// A mode change replaces no document, so it leaves a waiting pick alone: the card still lands.
test('an inline-menu pick that waits across a mode change still lands', async ({ page }) => {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('inline-menu');
	await editor.focusBlockEnd(TARGET);
	await editor.typeText(' @ad');
	await expect(page.locator('[data-inline-menu]')).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-inline-menu]')).toHaveCount(0);

	await editor.setPresentationMode('live');
	await editor.focusBlockEnd(TARGET);
	await page.evaluate(() => window.__releaseHeldCommit?.());

	await editor.bridge.waitForSourceContains('> card');
});
