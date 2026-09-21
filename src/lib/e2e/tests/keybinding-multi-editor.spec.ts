import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { EditorPage } from '../editor-page';

// Each editor adds its own keydown listener to the shared document, so these cases check that
// a shortcut reaches only one editor, and that a single editor on a page still takes its own
// shortcuts, which the check for that must not strand.

async function gotoMulti(page: Page): Promise<{ left: Locator; right: Locator }> {
	await page.goto('/test/multi-editor');
	// Waits for hydration, so both editors' mount effects have run, keydown listeners
	// included, and no shortcut races an editor that is not ready.
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

// Type at the end of an editor's first editable block, then wait past the undo debounce so the
// typing lands as one undoable entry. The click also makes this the editor last interacted with.
async function editEditor(page: Page, editor: Locator, mark: string): Promise<void> {
	await editor.locator('[contenteditable]').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(mark);
	await expect(editor).toContainText(mark);
	await page.waitForTimeout(300); // past the 250ms undo debounce, so the typing is one undo entry
}

test.describe('multi-editor document-chord containment', () => {
	test('Ctrl+F with focus outside every editor opens no search bar', async ({ page }) => {
		await gotoMulti(page);
		await page.locator('[data-testid="outside-input"]').focus();
		await page.keyboard.press('ControlOrMeta+f');
		await page.waitForTimeout(150); // checking nothing happens; there is nothing to wait on
		await expect(page.locator('.search-bar')).toHaveCount(0);
	});

	test("an in-focus Ctrl+F opens only the focused editor's search bar", async ({ page }) => {
		const { left } = await gotoMulti(page);
		await left.locator('[contenteditable]').first().click();
		await expect.poll(() => activeEditorIndex(page)).toBe(0);
		await page.keyboard.press('ControlOrMeta+f');

		// Exactly one bar opens, and it belongs to the focused editor on the left: a search
		// handler that ignores focus opens both.
		await expect(page.locator('.search-bar')).toHaveCount(1);
		await expect(left.locator('.search-bar')).toHaveCount(1);
	});

	test('a body-level Ctrl+Z reverts only the last-interacted editor', async ({ page }) => {
		const { left, right } = await gotoMulti(page);
		await editEditor(page, right, 'RIGHTMARK'); // right interacted first
		await editEditor(page, left, 'LEFTMARK'); // left last, so it takes a key sent to <body>

		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('ControlOrMeta+z');

		// Ignoring keys that arrive on <body> would leave undo dead once the caret's block is
		// unmounted (perf/vr-reveal F2); taking them always would reach too far, which is what
		// the last-interacted rule prevents.
		await expect(left).not.toContainText('LEFTMARK');
		await expect(right).toContainText('RIGHTMARK');
	});
});

test.describe('single-editor document-chord claim', () => {
	// What a single editor on a page takes: it takes the key when focus is inside it, on a
	// control of the app's that is not a text field, or on <body>; it leaves the key alone when
	// focus is in a text field of the app's, so it never takes a shortcut from a field the user
	// is typing in.

	// Focus on a control beside the editor is neither inside it nor on <body>, so a rule that
	// demands one of those strands the shortcut, and only a single editor taking it can deliver
	// it. That is what broke Ctrl+H after a click on the reading-mode toggle.
	test('the sole editor claims Ctrl+F while an outside control holds focus', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');

		// Focus a header control outside the editor without clicking, since a click would
		// switch the mode. Focus now rests on a real element that is neither <body> nor inside
		// the editor, which is the state a click on the reading-mode toggle leaves behind.
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

		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
	});

	test('the sole editor yields Ctrl+F to a foreign text-entry focus', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');

		// The app's own <textarea>, mounted outside the editor. Its counterpart, a checkbox of
		// the app's, is taken in the case above; a text field must not be.
		await page.evaluate(() => {
			const field = document.createElement('textarea');
			field.setAttribute('data-testid', 'foreign-textarea');
			document.body.appendChild(field);
		});
		const foreign = page.getByTestId('foreign-textarea');
		await foreign.focus();
		await expect(foreign).toBeFocused();

		await page.keyboard.press('ControlOrMeta+f');
		await page.waitForTimeout(150); // checking nothing happens; there is nothing to wait on

		// No Find bar opens, and focus stays in the app's field: a single editor that took the
		// key regardless would open its bar and pull focus into it.
		await expect(page.locator('.search-bar')).toHaveCount(0);
		await expect(foreign).toBeFocused();
	});

	test('the sole editor claims Ctrl+F when focus is inside it', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('# Title\n\nAlpha paragraph\n');
		await editor.focusBlockEnd(1);

		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.getByRole('textbox', { name: 'Find' })).toBeVisible();
	});
});
