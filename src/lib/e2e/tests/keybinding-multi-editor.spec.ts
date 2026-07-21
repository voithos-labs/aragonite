import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { primaryModifier } from '../platform';

// Two plain editors plus an outside input on one page (/test/multi-editor). Each
// editor installs its own document-level keydown listener on the shared document;
// these specs pin that every document-level chord stays contained to one instance —
// and that a lone editor still claims its own document-level chords (the single-editor
// describe at the foot), which the instance-containment gate must not strand.

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

test.describe('single-editor document-chord claim', () => {
	// The full claim truth-table for a lone editor: focus inside → claims; focus on a
	// foreign NON-text control (a checkbox toggle) or <body>/nowhere → claims (the
	// pre-containment page-wide reach); focus in a foreign TEXT-entry surface (a
	// consumer's own <textarea>/<input>) → yields, so the editor never hijacks a
	// page-global Ctrl+F away from a text field the user is typing in (B2-F1).

	// A lone editor claims its own search chord even when native focus rests on a
	// sibling control OUTSIDE it (a toolbar toggle), not just on <body>. The
	// containment gate strands this if it demands focus-inside-or-body: root.contains
	// is false and the target isn't <body>, so only the sole-editor claim can route
	// the chord. (Regression: the gate broke Ctrl+H after a click on the reading-mode
	// toggle left focus on that checkbox — presentation-reading.)
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

		// No Find bar opens, and focus stays in the consumer's field (pre-fix the sole
		// editor claimed unconditionally, opened its bar, and stole focus into it).
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
