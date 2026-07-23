import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, readDoc, roundTripStable, waitForDoc } from './helpers';

/**
 * Native GitHub alerts: a `> [!TYPE]` blockquote renders as a styled alert box with
 * its bytes untouched, editable in the body, kind-stable across edits. On
 * `/test/plugins?seed=admonitions` the seed's native alert is a `caution` (block 5);
 * the callout dogfood owns `note`/`warning`, so a typed alert uses `tip`. Gates read
 * the CST/source by path via `window.__test`; input is real keyboard/mouse.
 */

test.describe('plugin github alerts', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
	});

	test('the loaded alert renders styled with its GitHub bytes untouched', async ({ page }) => {
		const box = page.locator(".admonition[data-alert-source='github'][data-kind='caution']");
		await expect(box).toHaveCount(1);
		await expect(box).toHaveAttribute('data-title-empty', 'true');

		// The badge stands in for the marker: a CSS ::after, not editable title bytes.
		const badge = await box
			.locator('.admonition-title')
			.evaluate((el) => getComputedStyle(el, '::after').content);
		expect(badge).toContain('Caution');

		// The alert block keeps its verbatim GitHub bytes — never rewritten to `:::caution`.
		expect((await readDoc(page)).kinds[5]).toBe('githubAlert');
		expect((await readContainer(page, 5)).raw).toBe('> [!CAUTION]\n> Still a blockquote alert.\n');
	});

	test('editing the body rebuilds through the marker and keeps the githubAlert kind', async ({
		page
	}) => {
		await editor.focusBlockAtPath([5, 0], 'Still a blockquote alert.'.length);
		await editor.typeText(' EDITED');

		await editor.bridge.waitForSourceContains('Still a blockquote alert. EDITED');
		const source = await editor.bridge.getSource();
		// The marker survived the rebuild verbatim; the kind is stable.
		expect(source).toContain('> [!CAUTION]\n> Still a blockquote alert. EDITED');
		expect((await readDoc(page)).kinds[5]).toBe('githubAlert');
		expect(await roundTripStable(page)).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceContains('> [!CAUTION]\n> Still a blockquote alert.\n');
		await editor.bridge.waitForSourceNotContains('EDITED');
	});

	test('Backspace at the body start unwraps the alert, dropping the marker', async ({ page }) => {
		await editor.loadContent('> [!TIP]\n> hello there\n');
		const inner = page.locator('.admonition [contenteditable="true"]').first();
		await inner.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');

		// The body block lifts out and the marker drops: no alert remains, the content is
		// a plain block, and the bytes are never rewritten to `:::`.
		await waitForDoc(page, (s) => !s.kinds.includes('githubAlert'));
		const doc = await readDoc(page);
		expect(doc.kinds).not.toContain('githubAlert');
		expect(doc.texts).toContain('hello there');
		expect(await editor.bridge.getSource()).not.toContain('[!TIP]');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('typing a marker line then a body from scratch lands a native alert', async ({ page }) => {
		await editor.loadContent('Start here.\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Enter');
		// Completing the marker forms an empty alert with the caret in its body, so the
		// body is typed straight on — no second Enter (which would exit the quote).
		await editor.typeText('> [!TIP]');
		await editor.typeText('Fresh alert body');

		const doc = await waitForDoc(page, (s) => s.kinds.includes('githubAlert'));
		const alertIndex = doc.kinds.indexOf('githubAlert');
		expect((await readContainer(page, alertIndex)).childTexts).toContain('Fresh alert body');
		expect(await editor.bridge.getSource()).toContain('> [!TIP]\n> Fresh alert body');
		expect(await roundTripStable(page)).toBe(true);
	});
});
