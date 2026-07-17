import { test } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test('diag drag from image', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('a![cat](/test-fixtures/sample.png)b\n\nsecond paragraph\n');
	const widget = page.locator('[data-image-widget]').first();
	await widget.waitFor();
	const box = await widget.boundingBox();
	const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	// Recompute the target AFTER pointerdown (the select overlay may shift layout).
	const end = await editor.pointForOffset([1], 6);
	for (let i = 1; i <= 12; i++) {
		const t = i / 12;
		await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
	}
	await page.waitForTimeout(100);
	const cross = await editor.bridge.isCrossBlockActive();
	const sel = await editor.bridge.getSelectionPaths();
	const endResolve = await page.evaluate((pt) => {
		let cur: Element | null = document.elementFromPoint(pt.x, pt.y);
		while (cur) {
			const a = cur.getAttribute?.('data-block-path');
			if (a) return a;
			cur = cur.parentElement;
		}
		return null;
	}, end);
	console.log('RESULT cross:', cross, 'sel:', JSON.stringify(sel), 'endBlockPath:', endResolve);
	await page.mouse.up();
});
