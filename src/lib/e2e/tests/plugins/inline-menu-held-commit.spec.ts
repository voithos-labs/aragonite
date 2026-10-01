import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * A pick whose `onCommit` waits: the author's typing in the meantime is its own undo entry.
 * Requirements: e2e/requirements/plugins/inline-menu-held-commit.md.
 */

/** `Type here`, the plain typing target. */
const TARGET = 2;

test.describe('an inline-menu pick whose commit waits', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('typing while the commit waits is its own entry: three presses, three steps back', async () => {
		await editor.typeText(' @ad');
		await expect(editor.page.locator('[data-inline-menu]')).toBeVisible();
		const typed = await editor.bridge.getSource();
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('Type here @Ada');
		const picked = await editor.bridge.getSource();
		await editor.typeText('xy');
		await editor.bridge.waitForSourceContains('Type here @Adaxy');
		const typedAfter = await editor.bridge.getSource();

		await editor.page.evaluate(() => window.__releaseHeldCommit?.());
		await editor.bridge.waitForSourceContains('> card');
		await editor.waitForRenderFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(typedAfter);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(picked);
		await editor.undo();
		await editor.bridge.waitForSourceEquals(typed);
	});

	test('a bare modifier is not input: the late card stays in the pick’s entry', async () => {
		await editor.typeText(' @ad');
		await expect(editor.page.locator('[data-inline-menu]')).toBeVisible();
		const typed = await editor.bridge.getSource();
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('Type here @Ada');
		await editor.page.keyboard.press('Shift');

		await editor.page.evaluate(() => window.__releaseHeldCommit?.());
		await editor.bridge.waitForSourceContains('> card');
		await editor.waitForRenderFlush();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(typed);
	});
});

// The pick was made in one note; a host that loads another before the commit is released must
// find that note untouched, and must still be able to write into it itself.
test.describe('an inline-menu pick whose commit waits across a source swap', () => {
	let editor: PluginsPage;
	const next = 'note b one\n\nnote b two\n';

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
		await editor.typeText(' @ad');
		await expect(editor.page.locator('[data-inline-menu]')).toBeVisible();
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('Type here @Ada');
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.bridge.waitForSourceEquals(next);
	});

	test('the released commit lands nowhere, even with a caret in the next note', async ({
		page
	}) => {
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
