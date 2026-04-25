import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { primaryModifier } from '../../../platform';

test.describe('list marker inside contenteditable', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('unordered marker renders as .md-marker span inside first child', async () => {
		await editor.loadContent('- Hello\n');
		const markerInside = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		await expect(markerInside).toHaveText('- ');

		const oldFlexSibling = editor.page.locator('span.list-item-marker');
		await expect(oldFlexSibling).toHaveCount(0);
	});

	test('ordered marker renders with correct number inside first child', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const markers = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		await expect(markers.nth(0)).toHaveText('1. ');
		await expect(markers.nth(1)).toHaveText('2. ');
	});

	test('source round-trips after load', async () => {
		await editor.loadContent('- Hello\n');
		expect(await editor.bridge.getSource()).toBe('- Hello\n');
	});

	test('Home then typing inserts at raw offset 0', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- XHello\n');
	});

	test('click in marker region lands cursor at raw offset 0', async () => {
		await editor.loadContent('- Hello\n');
		const marker = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker'
		);
		const box = await marker.boundingBox();
		if (!box) throw new Error('marker not visible');
		await editor.page.mouse.click(box.x + 1, box.y + box.height / 2);
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- XHello\n');
	});

	test('Ctrl+A selects content only, marker preserved on replace', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press(`${primaryModifier}+KeyA`);

		const selectedText = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('Hello');

		await editor.typeText('World');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- World\n');
	});

	test('Backspace at raw 0 of first item performs U1 unwrap', async () => {
		await editor.loadContent('- Hello\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('Hello\n');
	});

	test('Backspace at raw 0 of non-first item performs M1 merge', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- AlphaBeta\n');
	});

	test('multi-digit ordered marker cursor math works', async () => {
		await editor.loadContent(
			'1. one\n2. two\n3. three\n4. four\n5. five\n6. six\n7. seven\n8. eight\n9. nine\n10. ten\n'
		);
		const tenth = editor.page.locator('[contenteditable="true"]', { hasText: 'ten' });
		await tenth.click();
		await editor.page.keyboard.press('Home');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('10. Xten');
		expect(await editor.bridge.getSource()).toContain('10. Xten');
	});

	test('nested list: each level gets its own ambient marker', async () => {
		await editor.loadContent('- Parent\n  - Child\n');
		const markers = editor.page.locator(
			'.list-item-block [contenteditable="true"] > span.md-marker[contenteditable="false"]'
		);
		expect(await markers.count()).toBe(2);
		await expect(markers.nth(0)).toHaveText('- ');
		await expect(markers.nth(1)).toHaveText('- ');
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

	test('first child has hanging-indent style scoped by ambient length', async () => {
		await editor.loadContent('- Hello\n\n1. one\n\n10. ten\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');

		const styles = await items.evaluateAll((els) =>
			els.map((el) => ({
				textIndent: (el as HTMLElement).style.textIndent,
				paddingLeft: (el as HTMLElement).style.paddingLeft
			}))
		);

		expect(styles).toEqual([
			{ textIndent: '-2ch', paddingLeft: '2ch' },
			{ textIndent: '-3ch', paddingLeft: '3ch' },
			{ textIndent: '-4ch', paddingLeft: '4ch' }
		]);
	});

	test('non-first paragraph in a loose list item has no hanging-indent style', async () => {
		await editor.loadContent('- first\n\n  second\n');
		const blocks = editor.page.locator('.list-item-block .text-editable-block');
		const styles = await blocks.evaluateAll((els) =>
			els.map((el) => ({
				textIndent: (el as HTMLElement).style.textIndent,
				paddingLeft: (el as HTMLElement).style.paddingLeft
			}))
		);

		expect(styles[0]).toEqual({ textIndent: '-2ch', paddingLeft: '2ch' });
		expect(styles[1]).toEqual({ textIndent: '', paddingLeft: '' });
	});

	test('empty list item renders ambient marker plus <br> fallback', async () => {
		await editor.loadContent('- \n');
		const item = editor.page.locator('.list-item-block [contenteditable="true"]').first();
		const marker = item.locator('> span.md-marker[contenteditable="false"]');
		await expect(marker).toHaveText('- ');

		const br = item.locator('> br');
		await expect(br).toHaveCount(1);

		await item.click();
		await editor.typeText('X');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getSource()).toBe('- X\n');
	});
});
