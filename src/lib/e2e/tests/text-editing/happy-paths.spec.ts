import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('text editing — happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing appends to block and updates source', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' world');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello world');
	});

	test('Enter at end splits block — creates new empty block after current', async () => {
		await editor.loadContent('Line one\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);
		expect(await editor.getBlockText(0)).toContain('Line one');
	});

	test('Enter in middle splits content across two blocks', async () => {
		await editor.loadContent('HelloWorld\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);

		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello');
		expect(source).toContain('World');
	});

	test('Backspace at start merges with previous paragraph', async () => {
		await editor.loadContent('First\n\nSecond\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');

		const source = await editor.bridge.getSource();
		expect(source).toContain('FirstSecond');
	});

	test('typing # prefix converts paragraph to heading', async () => {
		await editor.loadContent('Title\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');

		const kind = await editor.bridge.getBlockKind(0);
		expect(kind).toBe('heading');
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
