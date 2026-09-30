import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// A task marker belongs to the item's first paragraph (GFM task lists). Requirements:
// `e2e/requirements/blocks/list/task-checkbox/heading-cycle.md`.

test.describe('task checkbox: the item cycled to a heading', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	test('Mod+1 on a task item makes a heading item and takes the checkbox with it', async ({
		page
	}) => {
		await editor.loadContent('- [ ] alpha\n- [ ] beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();

		await page.keyboard.press('ControlOrMeta+1');

		await editor.bridge.waitForSourceContains('- # beta');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] alpha\n- # beta');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
		await expect(page.locator('.heading-1')).toHaveCount(1);
	});

	test('one Mod+Z puts the checkbox and the paragraph back together', async ({ page }) => {
		await editor.loadContent('- [ ] alpha\n- [ ] beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();
		await page.keyboard.press('ControlOrMeta+1');
		await editor.bridge.waitForSourceContains('- # beta');

		await editor.undo();

		await editor.bridge.waitForSourceContains('- [ ] beta');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] alpha\n- [ ] beta');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);
	});

	test('a second paragraph of a task item cycles alone; the checkbox stays', async ({ page }) => {
		await editor.loadContent('- [ ] alpha\n\n  second\n');
		await editor.page.getByText('second').click();
		await editor.waitForRenderFlush();

		await page.keyboard.press('ControlOrMeta+2');

		await editor.bridge.waitForSourceContains('## second');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] alpha\n\n  ## second');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
	});
});
