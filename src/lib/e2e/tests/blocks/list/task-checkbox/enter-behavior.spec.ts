import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox: Enter in a to-do', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The completer replaces the paragraph outright rather than re-kinding it, and a marker left
	// standing in front of a table serializes a to-do the editor draws no box for.
	test('Enter completing a table takes the checkbox with the paragraph', async () => {
		await editor.loadContent('- [ ] \n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('| a | b |');

		await editor.page.keyboard.press('Enter');

		await editor.bridge.waitForSourceContains('| --- |');
		expect(await editor.bridge.getSource()).not.toContain('[ ]');
		await expect(editor.page.locator('.task-checkbox')).toHaveCount(0);
	});

	// Both halves read as the text after a task marker, the way a reload reads them.
	for (const { what, seed, offset, expected } of [
		{ what: 'inside `# adwada`', seed: '- [ ] # adwada', offset: 4, expected: ['# ad', 'wada'] },
		{
			what: 'before the `#` of `ab# cd`',
			seed: '- [ ] ab# cd',
			offset: 2,
			expected: ['ab', '# cd']
		}
	]) {
		test(`Enter ${what} leaves two to-dos with text beside each box`, async () => {
			await editor.loadContent(`${seed}\n`);
			await editor.focusBlockAtPath([0, 0, 0], offset);

			await editor.page.keyboard.press('Enter');

			const source = expected.map((text) => `- [ ] ${text}\n`).join('');
			await editor.bridge.waitForSourceEquals(source);
			await expect(editor.page.locator('.task-checkbox')).toHaveCount(2);
			await expect(editor.page.locator('.heading-1')).toHaveCount(0);
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
