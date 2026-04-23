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

		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		await editor.pressKey('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockEnd(2);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

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

		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+x');
		await editor.waitForCrossBlock(false);

		const source = await editor.getSource();
		expect(source).not.toContain('alpha');
		expect(source).not.toContain('beta');
		expect(source).not.toContain('gamma');
	});

	test('Ctrl+A from inside a list item escalates to whole document on second press', async () => {
		await editor.loadContent('Before\n\n- Hello\n\nAfter\n');

		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Hello' });
		await item.click();

		// First press: selects the item's content only (marker excluded).
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		expect(await editor.isCrossBlockActive()).toBe(false);
		const firstSelection = await editor.page.evaluate(
			() => window.getSelection()?.toString() ?? ''
		);
		expect(firstSelection).toBe('Hello');

		// Second press: escalates to whole-document cross-block selection.
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);
	});

	test('select-all cut then paste replaces with clipboard', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(0);

		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);

		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('one');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});
});
