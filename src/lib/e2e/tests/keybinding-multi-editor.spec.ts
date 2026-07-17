import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';

// Two plain editors plus an outside input on one page (/test/multi-editor). Each
// editor installs its own document-level keydown listener on the shared document;
// these specs pin that every document-level chord stays contained to one instance.

async function gotoMulti(page: Page): Promise<{ left: Locator; right: Locator }> {
	await page.goto('/test/multi-editor');
	// Gate on hydration: both editors' mount effects — including each document-level
	// keydown listener — have run, so a chord never races a cold editor.
	await page.waitForFunction(
		() => (window as unknown as { __editorsReady?: boolean }).__editorsReady === true,
		null,
		{ timeout: 10_000 }
	);
	const editors = page.locator('.editor');
	return { left: editors.nth(0), right: editors.nth(1) };
}

const activeEditorIndex = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.editor')].findIndex((e) => e.contains(document.activeElement))
	);

// Type at the end of an editor's first editable, then wait past the undo batch
// debounce so the run lands as one committed, undoable entry. The click also makes
// this editor the last-interacted instance.
async function editEditor(page: Page, editor: Locator, mark: string): Promise<void> {
	await editor.locator('[contenteditable]').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(mark);
	await expect(editor).toContainText(mark);
	await page.waitForTimeout(300);
}

test.describe('multi-editor document-chord containment', () => {
	test('Ctrl+F with focus outside every editor opens no search bar', async ({ page }) => {
		await gotoMulti(page);
		await page.locator('[data-testid="outside-input"]').focus();
		await page.keyboard.press('Control+f');
		await page.waitForTimeout(150); // absence check — no shape to poll for
		await expect(page.locator('.search-bar')).toHaveCount(0);
	});

	test("an in-focus Ctrl+F opens only the focused editor's search bar", async ({ page }) => {
		const { left } = await gotoMulti(page);
		await left.locator('[contenteditable]').first().click();
		await expect.poll(() => activeEditorIndex(page)).toBe(0);
		await page.keyboard.press('Control+f');

		// Exactly one bar opens, and it belongs to the focused (left) editor —
		// pre-fix the search arm ignored focus, so both editors opened their bars.
		await expect(page.locator('.search-bar')).toHaveCount(1);
		await expect(left.locator('.search-bar')).toHaveCount(1);
	});

	test('a body-level Ctrl+Z reverts only the last-interacted editor', async ({ page }) => {
		const { left, right } = await gotoMulti(page);
		await editEditor(page, right, 'RIGHTMARK'); // right interacted first
		await editEditor(page, left, 'LEFTMARK'); // left last — it owns a body chord

		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('Control+z');

		// The last-interacted (left) editor claims the body-level chord and reverts;
		// the right editor is untouched. Dropping the body arm would leave the
		// windowed-out caret's undo dead (vr-reveal F2); accepting body unconditionally
		// is the multi-instance overreach the last-interacted gate closes.
		await expect(left).not.toContainText('LEFTMARK');
		await expect(right).toContainText('RIGHTMARK');
	});
});
