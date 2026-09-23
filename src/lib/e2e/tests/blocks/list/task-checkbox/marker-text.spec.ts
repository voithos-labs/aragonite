import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// The text after a task marker is the item's paragraph (GFM task lists), so a `#` there is text.
// Requirements: `e2e/requirements/blocks/list/task-checkbox/marker-text.md`.

test.describe('task checkbox: the text after the marker', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
	});

	test('a loaded `- [ ] # adwada` shows `# adwada` as text beside the box', async ({ page }) => {
		await editor.loadContent('- [ ] # adwada\n');

		await expect(page.locator('.task-checkbox')).toHaveCount(1);
		await expect(page.locator('.heading-1')).toHaveCount(0);
		await expect(page.locator('.list-item-block')).toContainText('# adwada');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('the box still toggles the marker of such an item', async ({ page }) => {
		await editor.loadContent('- [ ] # adwada\n');

		await page.locator('.task-checkbox').first().click();

		await editor.bridge.waitForSourceContains('[x]');
		expect(await editor.bridge.getSource()).toBe('- [x] # adwada\n');
		await expect(page.locator('.heading-1')).toHaveCount(0);
	});

	test('typing in a loaded `- [ ] # beta` keeps the marker and the text', async ({ page }) => {
		await editor.loadContent('- [ ] # beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();
		await page.keyboard.press('End');

		await page.keyboard.type('X');

		await editor.bridge.waitForSourceContains('betaX');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] # betaX');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
		await expect(page.locator('.heading-1')).toHaveCount(0);
	});

	test('`# ` typed in an empty to-do stays text beside the box', async ({ page }) => {
		await editor.loadContent('- [ ] alpha\n- [ ] \n');
		await editor.focusBlockAtPath([0, 1, 0], 0);

		await page.keyboard.type('#t');
		await editor.bridge.waitForSourceContains('- [ ] #t');
		await page.keyboard.press('Backspace');
		await page.keyboard.type(' ');

		await editor.bridge.waitForSourceContains('- [ ] # ');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);
		await expect(page.locator('.heading-1')).toHaveCount(0);
		expect(await editor.parseConverged()).toBe(true);
	});

	test('`# ` typed in front of a to-do keeps the box', async ({ page }) => {
		await editor.loadContent('- [ ] alpha\n- [ ] beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();
		await page.keyboard.press('Home');

		await page.keyboard.type('# ');

		await editor.bridge.waitForSourceContains('- [ ] # beta');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] alpha\n- [ ] # beta');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);
		await expect(page.locator('.heading-1')).toHaveCount(0);
		expect(await editor.parseConverged()).toBe(true);
	});

	for (const { what, seed, offset, halves } of [
		{ what: 'inside `# adwada`', seed: '- [ ] # adwada', offset: 4, halves: ['# ad', 'wada'] },
		{ what: 'before the `#` of `ab# cd`', seed: '- [ ] ab# cd', offset: 2, halves: ['ab', '# cd'] }
	]) {
		test(`Enter ${what} leaves two to-dos with text beside each box`, async ({ page }) => {
			await editor.loadContent(`${seed}\n`);
			await editor.focusBlockAtPath([0, 0, 0], offset);

			await page.keyboard.press('Enter');

			await editor.bridge.waitForSourceEquals(halves.map((text) => `- [ ] ${text}\n`).join(''));
			await expect(page.locator('.task-checkbox')).toHaveCount(2);
			await expect(page.locator('.heading-1')).toHaveCount(0);
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
