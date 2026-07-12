import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: paste basics', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+V with cross-block selection deletes range and pastes', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.page.evaluate(() => navigator.clipboard.writeText('PASTED'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('PASTED');
		const source = await editor.bridge.getSource();
		expect(source).toContain('PASTED');
		expect(source).toContain('aaa');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('multi-block paste with single-block selection is one undo unit', async () => {
		await editor.loadContent('hello world\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('alpha');
		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('world');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s) => s.trim() === 'hello world', null);
		const afterUndo = await editor.bridge.getSource();
		expect(afterUndo.trim()).toBe('hello world');
	});
});

test.describe('cross-block clipboard: multi-block paste at single caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Exact-source assertions catch structural-paste misroutes that leave the
	// substrings the original waitForSourceContains checks intact while the
	// surrounding splice rots.
	test('pasting two paragraphs creates multiple blocks', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Heading\n\nNew paragraph\n'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('# Heading');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['Hello', '', '# Heading', '', 'New paragraph'].join('\n')
		);
		// Live-CST count, not the reparse count (which folds blank lines back into
		// trivia and reads 3). The clipboard's internal blank line materializes as
		// a real empty-paragraph row (paste-materializes-blank-lines), so the tree
		// is Hello / heading / blank-row / New paragraph — four rendered blocks.
		expect(await editor.bridge.getBlockCount()).toBe(4);
	});

	test('multi-block paste replaces selected text', async () => {
		await editor.loadContent('Hello World\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.page.evaluate(() => navigator.clipboard.writeText('First\n\nSecond'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('Second');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['Hello ', '', 'First', '', 'Second'].join('\n')
		);
	});
});
