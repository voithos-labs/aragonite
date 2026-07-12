import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('text editing — user interactions', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('click, focusBlockEnd, typeText, verify source', async () => {
		await editor.loadContent('Hello\n');
		await editor.clickBlock(0);
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' world');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
	});

	test('split then type in new block updates source', async () => {
		await editor.loadContent('Original\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		await editor.typeSlowly('New content');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Original');
		expect(source).toContain('New content');
	});

	test('rapid split — Enter twice creates three blocks', async () => {
		await editor.loadContent('Start\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(3);
	});

	test('Backspace mid-block deletes character, does not merge', async () => {
		await editor.loadContent('First\n\nSecond\n');
		const countBefore = await editor.getDomBlockCount();

		await editor.focusBlockEnd(1);
		await editor.page.keyboard.press('Backspace');

		const countAfter = await editor.getDomBlockCount();
		expect(countAfter).toBe(countBefore);

		const source = await editor.bridge.getSource();
		expect(source).toContain('Secon');
		expect(source).not.toContain('Second');
	});
});
