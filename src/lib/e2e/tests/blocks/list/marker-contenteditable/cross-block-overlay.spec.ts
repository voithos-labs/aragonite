import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list marker — cross-block selection overlay edge', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('C1: cross-block selection ending in list item — overlay starts at content edge, not marker edge', async () => {
		await editor.loadContent('Before.\n\n- Hello\n');
		const before = editor.page.locator('[contenteditable="true"]', { hasText: 'Before' });
		await before.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.down('Shift');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.up('Shift');

		await editor.waitForCrossBlock(true);

		const markerBox = await editor.page
			.locator('.list-item-block [contenteditable="true"] > span.md-marker')
			.boundingBox();
		if (!markerBox) throw new Error('marker not visible');
		const markerRight = markerBox.x + markerBox.width;

		const overlays = editor.page.locator('.selection-overlay');
		const overlayCount = await overlays.count();
		expect(overlayCount).toBeGreaterThan(0);

		// No selection-overlay rect should bleed left of the marker's right edge.
		// Pre-fix, measurePartialRects(0, n) emitted DOM offset 0, painting over the marker;
		// the fix translates raw offset 0 → DOM offset = ambientLength.
		for (let i = 0; i < overlayCount; i++) {
			const box = await overlays.nth(i).boundingBox();
			if (!box) continue;
			// Skip overlays not in the list item's vertical band.
			if (box.y + box.height < markerBox.y || box.y > markerBox.y + markerBox.height) continue;
			expect(box.x).toBeGreaterThanOrEqual(markerRight - 1);
		}
	});
});
