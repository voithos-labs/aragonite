import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';

// A keystroke the tree rolls back, because a container's rebuild threw, leaves the source and the
// screen as they were (requirements/container-editing/keystroke-rollback.md).

const THROWN = 'probe rebuildRaw blew up';

const leafText = (page: Page) =>
	page.locator(`[data-block-path='${JSON.stringify([0, 0])}'] [contenteditable]`).first();

const throwOnQuoteRebuild = (page: Page, on: boolean) =>
	page.evaluate((value) => (window as any).__test.throwOnQuoteRebuild(value), on);

const capturedErrors = (page: Page): Promise<string[]> =>
	page.evaluate(() => (window as any).__test.getCapturedErrors());

test.describe('a keystroke inside a container whose rebuild throws', () => {
	let editor: EditorPage;

	test.use({ expectPageErrors: [THROWN] });

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('> ab\n');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
		await editor.focusBlockAtPath([0, 0], 2);
	});

	test.afterEach(async ({ page }) => {
		await throwOnQuoteRebuild(page, false);
	});

	test('a typed key reports the throw and leaves the source and the text as they were', async ({
		page
	}) => {
		await throwOnQuoteRebuild(page, true);

		await editor.typeSlowly('x');

		await expect.poll(() => capturedErrors(page)).toContain('commit');
		expect(await editor.bridge.getSource()).toBe('> ab\n');
		await expect(leafText(page)).toHaveText('ab');
	});

	test('the next key writes once the rebuild stops throwing, and one undo takes it back', async ({
		page
	}) => {
		await throwOnQuoteRebuild(page, true);
		await editor.typeSlowly('x');
		await expect.poll(() => capturedErrors(page)).toContain('commit');
		await throwOnQuoteRebuild(page, false);

		await editor.typeSlowly('y');
		await editor.bridge.waitForSourceContains('aby');
		await editor.undo();

		await editor.bridge.waitForSourceMatches(/^> ab\n$/);
		await expect(leafText(page)).toHaveText('ab');
	});

	// Each kind of editable element repaints itself, so each gets the typed-key row.
	for (const [kind, source, path, offset, kept] of [
		['code block', '> ```\n> ab\n> ```\n', [0, 0], 6, 'ab'],
		['table cell', '> | a | b |\n> | - | - |\n> | cd | e |\n', [0, 0, 1, 0], 1, 'cd']
	] as const) {
		test(`a key typed in a ${kind} inside the quote leaves the source and the text`, async ({
			page
		}) => {
			await editor.loadContent(source);
			await editor.clickBlockAtPath([...path], offset);
			await throwOnQuoteRebuild(page, true);

			await editor.typeSlowly('x');

			await expect.poll(() => capturedErrors(page)).toContain('commit');
			expect(await editor.bridge.getSource()).toBe(source);
			const shown =
				kind === 'table cell'
					? page.getByRole('row').nth(1).getByRole('cell').first()
					: page.locator(`[data-block-path='${JSON.stringify(path)}'] [contenteditable]`);
			await expect(shown).toContainText(kept);
			await expect(shown).not.toContainText('x');
		});
	}

	test('an IME commit reports the throw and leaves the source and the text as they were', async ({
		page
	}) => {
		await throwOnQuoteRebuild(page, true);
		const ime = await attachIme(page);

		await ime.compose('か');
		await ime.commit('か');

		await expect.poll(() => capturedErrors(page)).toContain('commit');
		expect(await editor.bridge.getSource()).toBe('> ab\n');
		await expect(leafText(page)).toHaveText('ab');
	});
});
