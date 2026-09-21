import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// A task marker belongs to the item's first paragraph (GFM § 5.3). Requirements:
// `e2e/requirements/blocks/list/task-checkbox/heading-cycle.md`.

test.describe('task checkbox — the item cycled to a heading', () => {
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

	// `- [ ] # note` is valid GFM that arrives by paste and by file. Nothing the user did took the
	// paragraph away, so no keystroke may rewrite the marker's bytes out from under them.
	test('typing in a loaded to-do heading leaves the task marker alone', async ({ page }) => {
		await editor.loadContent('- [ ] # beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();
		await page.keyboard.press('End');

		await page.keyboard.type('X');

		await editor.bridge.waitForSourceContains('betaX');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] # betaX');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
	});

	// The bare `#`, where the raw really is one byte: in an empty to-do the parser calls the block
	// a heading for that one keystroke, and taking the box then strips a to-do for typing a tag.
	test('`#` alone in an empty to-do keeps its box; the space that makes a heading takes it', async ({
		page
	}) => {
		await editor.loadContent('- [ ] alpha\n- [ ] \n');
		await editor.focusBlockAtPath([0, 1, 0], 0);

		await page.keyboard.type('#');
		await editor.bridge.waitForSourceContains('- [ ] #');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);
		await expect(page.locator('.heading-1')).toHaveCount(0);

		await page.keyboard.type('t');
		await editor.bridge.waitForSourceContains('- [ ] #t');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);

		await page.keyboard.press('Backspace');
		await page.keyboard.type(' ');
		await editor.bridge.waitForSourceContains('- # ');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
		await expect(page.locator('.heading-1')).toHaveCount(1);
	});

	test('`#t` typed in front of a to-do keeps its box; the space that makes a heading takes it', async ({
		page
	}) => {
		await editor.loadContent('- [ ] alpha\n- [ ] beta\n');
		await editor.page.getByText('beta').click();
		await editor.waitForRenderFlush();
		await page.keyboard.press('Home');

		// `#beta` is a paragraph, not a heading: the box has no reason to move for it.
		await page.keyboard.type('#');
		await editor.bridge.waitForSourceContains('- [ ] #beta');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);
		await page.keyboard.type('t');
		await editor.bridge.waitForSourceContains('- [ ] #tbeta');
		await expect(page.locator('.task-checkbox')).toHaveCount(2);

		await page.keyboard.press('Backspace');
		await page.keyboard.type(' ');
		await editor.bridge.waitForSourceContains('- # beta');
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ] alpha\n- # beta');
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
		await expect(page.locator('.heading-1')).toHaveCount(1);
	});
});
