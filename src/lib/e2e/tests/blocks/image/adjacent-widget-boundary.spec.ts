import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

/**
 * Two flush image widgets share a boundary (A.end === B.start) with no text node, so the caret is
 * the synthetic snap-after-A indicator and caret-edge dispatch must resolve it by key direction —
 * a document-order pick always answers A. Direction resolution: widget-adjacency.test.ts.
 */

const TWO_IMAGES = '![a](/test-fixtures/sample.png)![b](/test-fixtures/sample.png)\n';

// Snap to the A|B boundary the way a user reaches it: click just right of the first image, which
// snaps to its trailing edge (no text node lives there, so a synthetic snap caret marks the spot).
async function snapAfterFirstWidget(editor: EditorPage): Promise<void> {
	const point = await editor.page.evaluate(() => {
		const a = document.querySelectorAll('[data-image-widget]')[0].getBoundingClientRect();
		return { x: a.right + 2, y: a.top + a.height / 2 };
	});
	await editor.page.mouse.click(point.x, point.y);
	// Assert the edge, not just "some snap caret exists": every key test below depends on the caret
	// at A's TRAILING edge, so a wrong landing must fail here rather than downstream.
	await expect(editor.page.locator('[data-image-widget]').first()).toHaveClass(/md-snap-after/);
}

test.describe('caret at a shared adjacent-widget boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TWO_IMAGES);
		await expect(page.locator('[data-image-widget]')).toHaveCount(2);
		// An undecoded <img> lays out 0x0, so a click point computed before decode lands INSIDE A
		// once it does, selecting the widget instead of snapping past it. Only A needs the barrier
		// — B follows it.
		await waitForFirstImageLoaded(page);
	});

	test('Delete selects the following widget instead of deleting it', async ({ page }) => {
		await snapAfterFirstWidget(editor);
		await page.keyboard.press('Delete');

		// B survives — the forward key entered it (select), not consumed by native delete.
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
