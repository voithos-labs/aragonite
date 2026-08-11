import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { primaryModifier } from '../platform';

// Each editor installs its OWN document-level keydown listener on the shared document, so
// these pin that every chord stays contained to one instance — and that a lone editor still
// claims its own chords, which the containment gate must not strand.

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
	await page.waitForTimeout(300); // past the ~250ms undo-batch debounce so the run is one undo entry
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

		// Exactly one bar opens, and it belongs to the focused (left) editor: a search arm that
		// ignores focus opens both.
		await expect(page.locator('.search-bar')).toHaveCount(1);
		await expect(left.locator('.search-bar')).toHaveCount(1);
	});

	test('a body-level Ctrl+Z reverts only the last-interacted editor', async ({ page }) => {
		const { left, right } = await gotoMulti(page);
		await editEditor(page, right, 'RIGHTMARK'); // right interacted first
		await editEditor(page, left, 'LEFTMARK'); // left last — it owns a body chord

		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('Control+z');

		// Dropping the body arm leaves the windowed-out caret's undo dead (perf/vr-reveal F2);
		// accepting body unconditionally is the overreach the last-interacted gate closes.
		await expect(left).not.toContainText('LEFTMARK');
		await expect(right).toContainText('RIGHTMARK');
	});
});

test.describe('single-editor document-chord claim', () => {
	// The lone-editor claim truth-table: focus inside, on a foreign NON-text control, or on
	// <body> claims; focus in a foreign TEXT-entry surface YIELDS, so the editor never hijacks
	// a page-global chord away from a field the user is typing in.

	// Focus on a sibling control OUTSIDE the editor is neither inside-root nor <body>, so a
	// gate demanding one of those strands the chord entirely and only the sole-editor claim can
	// route it — the shape that broke Ctrl+H after a click on the reading-mode toggle.
	test('the sole editor claims Ctrl+F while an outside control holds focus', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');

		// Focus a header control OUTSIDE the editor without clicking (a click would flip
		// the mode); native focus now rests on a real element that is neither <body> nor
		// inside the editor — the exact state a reading-mode toggle click leaves behind.
		await page.getByTestId('presentation-toggle').focus();
		await expect
			.poll(() =>
				page.evaluate(() => {
					const active = document.activeElement;
					const editorRoot = document.querySelector('.editor');
					return active !== document.body && !!editorRoot && !editorRoot.contains(active);
				})
			)
			.toBe(true);

		await page.keyboard.press(`${primaryModifier}+f`);
		await expect(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
	});

	test('the sole editor yields Ctrl+F to a foreign text-entry focus', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');

		// A consumer's own <textarea>, mounted OUTSIDE the editor. Its type-list twin —
		// a foreign checkbox — is claimed above; a text-entry surface must not be.
		await page.evaluate(() => {
			const field = document.createElement('textarea');
			field.setAttribute('data-testid', 'foreign-textarea');
			document.body.appendChild(field);
		});
		const foreign = page.getByTestId('foreign-textarea');
		await foreign.focus();
		await expect(foreign).toBeFocused();

		await page.keyboard.press(`${primaryModifier}+f`);
		await page.waitForTimeout(150); // absence check — no shape to poll for

		// No Find bar opens, and focus stays in the consumer's field: a sole editor claiming
		// unconditionally opens its bar and steals focus into it.
		await expect(page.locator('.search-bar')).toHaveCount(0);
		await expect(foreign).toBeFocused();
	});

	test('the sole editor claims Ctrl+F when focus is inside it', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');
		await editor.focusBlockEnd(1);

		await page.keyboard.press(`${primaryModifier}+f`);
		await expect(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
	});
});
