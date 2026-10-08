import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { pointOffImageLine, waitForFirstImageLoaded } from './helpers';

// A picture sits on the baseline, so its paragraph's box is taller than it is. A click in the strip
// above or below the picture is still a click on the block's only line.
// Requirements: `e2e/requirements/blocks/image/caret-click-above-below-image.md`.

const IMAGE_PARAGRAPH = 'alpha\n\n![pic|300x200](/test-fixtures/sample.png)\n\nomega\n';

test.describe('a press above or below a picture, inside its own block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of ['source', 'live'] as const) {
		test(`${mode}: a press above or below the picture types on the side it was made`, async ({
			page
		}) => {
			await editor.loadContent(IMAGE_PARAGRAPH);
			await editor.setPresentationMode(mode);

			const pressAndType = async (side: 'above' | 'below', across: number): Promise<string> => {
				await editor.loadContent(IMAGE_PARAGRAPH);
				await waitForFirstImageLoaded(page);
				const at = await pointOffImageLine(page, side, across);
				await page.mouse.click(at.x, at.y);
				await page.keyboard.press('X');
				return editor.bridge.getSource();
			};

			for (const side of ['above', 'below'] as const) {
				await test.step(`${side} the picture, right of its middle, types after it`, async () => {
					const src = await pressAndType(side, 0.75);
					expect(src).toContain(')X');
					expect(src).toContain('alpha\n');
				});
			}

			await test.step('below the picture, left of its middle, types before it', async () => {
				expect(await pressAndType('below', 0.25)).toContain('X![pic');
			});
		});
	}
});
