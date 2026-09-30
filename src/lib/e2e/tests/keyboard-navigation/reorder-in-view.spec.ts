// Moving a block with Alt+ArrowDown keeps it on screen, since the caret moves with it: a move that
// carries the block past the bottom edge scrolls it back into view.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const LABELS = Array.from({ length: 60 }, (_, i) => `p${String(i).padStart(2, '0')}`);

test.describe('keyboard reorder keeps the moved block in view', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowDown from the bottom edge scrolls with the block, press after press', async () => {
		await editor.loadContent(LABELS.join('\n\n') + '\n');
		// The last block whose whole box is inside the editor's viewport.
		const label = await editor.page.evaluate(() => {
			const view = document.querySelector('.editor')!.getBoundingClientRect();
			const inView = [...document.querySelectorAll('.editor [contenteditable="true"]')].filter(
				(el) => el.getBoundingClientRect().bottom <= view.bottom
			);
			return inView[inView.length - 1].textContent!.trim();
		});
		const block = editor.page.locator('[contenteditable="true"]', { hasText: label });
		await block.click();

		for (let press = 1; press <= 6; press++) {
			await editor.page.keyboard.press('Alt+ArrowDown');
			const below = LABELS[LABELS.indexOf(label) + press];
			await editor.bridge.waitForSourceContains(`${below}\n\n${label}\n`);
			await expect
				.poll(async () => {
					const view = (await editor.editorContainer.boundingBox())!;
					const box = await block.boundingBox();
					return !!box && box.y < view.y + view.height && box.y + box.height > view.y;
				}, `after press ${press}`)
				.toBe(true);
		}
	});
});
