import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { pointOffImageLine, waitForFirstImageLoaded } from './helpers';

// A picture sits on the baseline, so its paragraph's box is taller than it is. A press in the
// strip above or below the picture is still a press on the block's only line.
// Requirements: `e2e/requirements/blocks/image/caret-click-above-below-image.md`.

const IMAGE_PARAGRAPH = 'alpha\n\n![pic|300x200](/test-fixtures/sample.png)\n\nomega\n';

test.describe('a press above or below a picture, inside its own block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(IMAGE_PARAGRAPH);
		await waitForFirstImageLoaded(page);
	});

	for (const side of ['above', 'below'] as const) {
		test(`a press ${side} the picture, right of its middle, types after it`, async ({ page }) => {
			const at = await pointOffImageLine(page, side, 0.75);
			await page.mouse.click(at.x, at.y);
			await page.keyboard.press('X');
			const src = await editor.bridge.getSource();
			expect(src).toContain(')X');
			expect(src).toContain('alpha\n');
		});
	}

	test('a press below the picture, left of its middle, types before it', async ({ page }) => {
		const at = await pointOffImageLine(page, 'below', 0.25);
		await page.mouse.click(at.x, at.y);
		await page.keyboard.press('X');
		expect(await editor.bridge.getSource()).toContain('X![pic');
	});
});
