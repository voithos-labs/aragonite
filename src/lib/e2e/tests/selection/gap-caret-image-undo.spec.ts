import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { AT_BOUNDARY, FENCE, TABLE, arriveAtBoundary } from './gap-caret-fixtures';

// An undo that puts a gap caret back while an image is selected
// (`requirements/selection/gap-caret-image-undo.md`).

const IMAGE = '![c|60x40](/test-fixtures/sample.png)';
/** image paragraph, table, fence, paragraph: the gap between table and fence is boundary 2. */
const IMAGE_TABLE_FENCE = `${IMAGE}\n\n${TABLE}\n${FENCE}\ntail\n`;

test('undo back into a gap caret ends a selected image, and typing makes a paragraph there', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(IMAGE_TABLE_FENCE);
	await arriveAtBoundary(editor);
	await editor.typeSlowly('x');
	await editor.bridge.waitForSourceContains('\nx\n');
	const overlay = page.locator('[data-image-overlay]');
	await page.locator('[data-image-widget]').first().click();
	await expect(overlay).toBeVisible();

	await editor.undo();

	await editor.bridge.waitForSourceEquals(IMAGE_TABLE_FENCE);
	await editor.bridge.waitForGapCaret(AT_BOUNDARY);
	await expect(overlay).toHaveCount(0);
	await editor.typeSlowly('y');
	await editor.bridge.waitForSourceContains('\ny\n');
	expect(await editor.bridge.getSource()).toBe(`${IMAGE}\n\n${TABLE}\ny\n\n${FENCE}\ntail\n`);
});
