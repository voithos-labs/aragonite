import { test, expect } from '../../fixtures';
import { DetailsPage, bodyHostCount, capturedErrors } from '../plugins/details-helpers';
import type { Page } from '@playwright/test';

/**
 * Reading mode's ONE interactive affordance: the `<details>` disclosure flips view state and
 * writes nothing (e2e/requirements/presentation/presentation-reading-details.md).
 * `bodyHostCount` is the load-bearing observable, not the caret or the arrow glyph — it
 * proves the collapse clamp genuinely mounted the body, the half `aria-expanded` would fake.
 */

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n\nBelow\n';
const OPENED = '<details open>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n\nBelow\n';

async function undoStackDump(page: Page): Promise<string> {
	return page.evaluate(() =>
		(window as never as { __test: { dumpUndoStack(): string } }).__test.dumpUndoStack()
	);
}

test.describe('reading mode — transient details disclosure', () => {
	let editor: DetailsPage;

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		await editor.gotoDetails();
		await editor.loadContent(CLOSED);
		expect(await bodyHostCount(page)).toBe(1);
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
	});

	test('a reader opens and re-closes a section without moving a byte or a history entry', async ({
		page
	}) => {
		const before = await editor.bridge.getSource();
		const stackBefore = await undoStackDump(page);
		await page.evaluate(() =>
			(window as never as { __test: { startEditOpCapture(): void } }).__test.startEditOpCapture()
		);

		await page.locator('.details-toggle').click();
		// The clamp mounted the body — the content is genuinely readable, not a caret
		// parked over an unmounted subtree.
		await expect.poll(() => bodyHostCount(page)).toBe(2);
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByText('Hidden')).toBeVisible();

		await page.locator('.details-toggle').click();
		await expect.poll(() => bodyHostCount(page)).toBe(1);
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await undoStackDump(page)).toBe(stackBefore);
		expect(
			await page.evaluate(
				() =>
					(
						window as never as { __test: { stopEditOpCapture(): string[] } }
					).__test.stopEditOpCapture().length
			)
		).toBe(0);
		// In particular the collapse-probe cross-check must stay quiet while the view
		// deliberately runs ahead of the document.
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('leaving reading mode discards the flip', async ({ page }) => {
		await page.locator('.details-toggle').click();
		await expect.poll(() => bodyHostCount(page)).toBe(2);

		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).not.toHaveAttribute('data-presentation');

		// The document called it collapsed and still does, so it is collapsed again.
		await expect.poll(() => bodyHostCount(page)).toBe(1);
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		expect(await editor.bridge.getSource()).toBe(CLOSED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test("the reader's first click is relative to the document state, so an open section closes", async ({
		page
	}) => {
		await editor.loadContent(OPENED);
		expect(await bodyHostCount(page)).toBe(2);

		await page.locator('.details-toggle').click();

		await expect.poll(() => bodyHostCount(page)).toBe(1);
		expect(await editor.bridge.getSource()).toBe(OPENED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('source mode still commits the flip as a real undoable edit', async ({ page }) => {
		// The never-writes rule is reading-mode-only; the editing disclosure is
		// untouched, undo included.
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).not.toHaveAttribute('data-presentation');

		await page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details open>');
		expect(await bodyHostCount(page)).toBe(2);

		await editor.undo();
		await editor.bridge.waitForSourceContains('<details>\n');
		expect(await editor.bridge.getSource()).toBe(CLOSED);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
