import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('select-all clipboard round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+A twice then copy then paste reproduces document content', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.page.waitForTimeout(100);

		await editor.page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockEnd(2);

		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.bridge.getSource();

		const firstCount = source.split('first para').length - 1;
		const secondCount = source.split('second para').length - 1;
		const thirdCount = source.split('third para').length - 1;
		expect(firstCount).toBeGreaterThanOrEqual(2);
		expect(secondCount).toBeGreaterThanOrEqual(2);
		expect(thirdCount).toBeGreaterThanOrEqual(2);
	});

	test('Ctrl+A twice then cut empties the document', async () => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+x');
		await editor.waitForCrossBlock(false);

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('alpha');
		expect(source).not.toContain('beta');
		expect(source).not.toContain('gamma');
	});

	test('Ctrl+A from inside a list item escalates to whole document on second press', async () => {
		await editor.loadContent('Before\n\n- Hello\n\nAfter\n');

		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await item.click();

		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(100);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		const firstSelection = await editor.page.evaluate(
			() => window.getSelection()?.toString() ?? ''
		);
		expect(firstSelection).toBe('Hello');

		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		const paths = await editor.bridge.getSelectionPaths();
		expect(paths).not.toBeNull();
		expect(paths!.anchor.path[0]).toBe(0);
		expect(paths!.focus.path[0]).toBe(2);

		await editor.page.keyboard.press('Backspace');
		await editor.waitForCrossBlock(false);
		await editor.page.waitForTimeout(200);

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('Before');
		expect(source).not.toContain('Hello');
		expect(source).not.toContain('After');
		expect(await editor.getDomBlockCount()).toBe(1);
	});

	test('select-all cut then paste replaces with clipboard', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(0);

		await editor.page.keyboard.press('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+x');
		await editor.page.waitForTimeout(300);

		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.bridge.getSource();
		expect(source).toContain('one');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});
});
