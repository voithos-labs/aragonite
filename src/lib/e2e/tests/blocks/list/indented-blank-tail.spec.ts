import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/list/indented-blank-tail.md`.

test.describe('a list item whose body ends in an empty paragraph', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test.describe('typing into the loaded item', () => {
		const shapes: [string, string, number[], string][] = [
			['a top-level item', '- a\n\n  \n\n- c\n', [0, 0, 0], '- ax\n\n  \n\n- c\n'],
			[
				'a nested item',
				'- a\n  - b\n\n    \n\n- c\n',
				[0, 0, 1, 0, 0],
				'- a\n  - bx\n\n    \n\n- c\n'
			]
		];
		for (const [name, source, path, after] of shapes) {
			test(`${name} keeps every byte but the typed one`, async ({ page }) => {
				await editor.loadContent(source);
				await editor.focusBlockAtPath(path, 1);

				await page.keyboard.type('x');

				await editor.bridge.waitForSourceContains('x');
				expect(await editor.bridge.getSource()).toBe(after);
				expect(await editor.parseConverged()).toBe(true);
			});
		}
	});

	test('emptying the last paragraph, typing, and undoing twice each reload as the tree held', async ({
		page
	}) => {
		const source = '- a\n\n  b\n\n- c\n';
		const blanked = '- a\n\n  \n\n- c\n';
		await editor.loadContent(source);
		await editor.focusBlockAtPath([0, 0, 1], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('b');
		expect(await editor.bridge.getSource()).toBe(blanked);
		expect(await editor.parseConverged()).toBe(true);
		await editor.waitForUndoBatchFlush();

		await page.keyboard.type('x');
		await editor.bridge.waitForSourceContains('x');
		expect(await editor.bridge.getSource()).toBe('- a\n\n  x\n\n- c\n');
		expect(await editor.parseConverged()).toBe(true);
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('x');
		expect(await editor.bridge.getSource()).toBe(blanked);
		expect(await editor.parseConverged()).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(source);
		expect(await editor.parseConverged()).toBe(true);
	});
});
