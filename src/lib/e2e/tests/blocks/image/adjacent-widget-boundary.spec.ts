import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

/**
 * Two image widgets sitting flush share a boundary (A.end === B.start) with no text node, so the
 * caret is the editor's own snap-after-A marker and the caret-edge dispatch has to resolve it by
 * which key was pressed: picking by document order always answers A. How the direction is
 * resolved: `widget-adjacency.test.ts`.
 */

const TWO_IMAGES = '![a](/test-fixtures/sample.png)![b](/test-fixtures/sample.png)\n';

// Snap to the A|B boundary the way a user reaches it: click just right of the first image, which
// snaps to its trailing edge (no text node lives there, so the editor draws its own caret there).
async function snapAfterFirstWidget(editor: EditorPage): Promise<void> {
	const point = await editor.page.evaluate(() => {
		const a = document.querySelectorAll('[data-image-widget]')[0].getBoundingClientRect();
		return { x: a.right + 2, y: a.top + a.height / 2 };
	});
	await editor.page.mouse.click(point.x, point.y);
	// Assert the edge, not just "some snap caret exists": every key test below depends on the caret
	// at A's trailing edge, so a wrong landing must fail here rather than downstream.
	await expect(editor.page.locator('[data-image-widget]').first()).toHaveClass(/md-snap-after/);
}

test.describe('caret at a shared adjacent-widget boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TWO_IMAGES);
		await expect(page.locator('[data-image-widget]')).toHaveCount(2);
		// An `<img>` that has not decoded lays out 0x0, so a click point worked out beforehand lands
		// inside A once it does, selecting the widget instead of snapping past it. Only A needs the
		// wait; B follows it.
		await waitForFirstImageLoaded(page);
	});

	test('Delete selects the following widget instead of deleting it', async ({ page }) => {
		await snapAfterFirstWidget(editor);
		await page.keyboard.press('Delete');

		// B survives: the forward key selected it rather than being consumed by a native delete.
		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		expect(await editor.bridge.getSource()).toContain('![b]');
		expect(await page.locator('[data-image-widget]').count()).toBe(2);
	});

	test('ArrowRight selects the following widget rather than skipping its entry', async ({
		page
	}) => {
		await snapAfterFirstWidget(editor);
		await page.keyboard.press('ArrowRight');

		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		expect(await editor.bridge.getSource()).toContain('![b]');
	});

	test('Backspace selects the preceding widget (backward direction unchanged)', async ({
		page
	}) => {
		await snapAfterFirstWidget(editor);
		await page.keyboard.press('Backspace');

		await expect(page.locator('[data-image-overlay]')).toBeVisible();
		expect(await editor.bridge.getSource()).toContain('![a]');
	});
});
