import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

/**
 * Two image widgets flush against each other share a boundary (A.end === B.start).
 * No text node lives there, so the caret is the synthetic snap-after-A indicator;
 * the caret-edge dispatch must resolve that boundary by key direction — forward
 * keys enter B, backward keys enter A. Pre-fix the document-order pick always
 * returned A, so a forward Delete consumed nothing and native contenteditable wiped
 * B's whole island. The direction resolution is unit-pinned (widget-adjacency.test.ts);
 * this drives the real snap gesture + key dispatch against the rendered widgets.
 */

const TWO_IMAGES = '![a](/test-fixtures/sample.png)![b](/test-fixtures/sample.png)\n';

// Snap the caret to the A|B boundary the way a user reaches it: click just right of
// the first image, which snaps to its trailing edge (no text node lives there, so a
// synthetic snap caret marks the spot).
async function snapAfterFirstWidget(editor: EditorPage): Promise<void> {
	const point = await editor.page.evaluate(() => {
		const a = document.querySelectorAll('[data-image-widget]')[0].getBoundingClientRect();
		return { x: a.right + 2, y: a.top + a.height / 2 };
	});
	await editor.page.mouse.click(point.x, point.y);
	// Assert the edge, not just "some snap caret exists": the three key tests all
	// depend on the caret sitting at A's TRAILING edge, so a landing on any other
	// edge has to fail here rather than downstream.
	await expect(editor.page.locator('[data-image-widget]').first()).toHaveClass(/md-snap-after/);
}

test.describe('caret at a shared adjacent-widget boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TWO_IMAGES);
		await expect(page.locator('[data-image-widget]')).toHaveCount(2);
		// An undecoded <img> lays out 0x0. Measure A's box before it decodes and the
		// click point computed from it lands INSIDE A once it does, which selects the
		// widget instead of snapping past its trailing edge, and no snap caret is ever
		// painted. Only A needs the barrier: it is first in block flow, so B's decode
		// cannot move it.
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
