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

		// Double Ctrl+A to select entire document
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);

		// Copy
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Collapse selection and move to end of last block
		await editor.pressKey('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockEnd(2);

		// Paste
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();

		// Each paragraph text should appear at least twice (original + paste)
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

		// Double Ctrl+A to select entire document
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);

		// Cut
		await editor.pressKey('Control+x');
		await editor.waitForCrossBlock(false);

		const source = await editor.getSource();
		expect(source).not.toContain('alpha');
		expect(source).not.toContain('beta');
		expect(source).not.toContain('gamma');
	});

	test('select-all cut then paste replaces with clipboard', async () => {
		await editor.loadContent('one\n\ntwo\n\nthree\n');
		await editor.focusBlockStart(0);

		// Double Ctrl+A → Ctrl+X
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(200);
		await editor.pressKey('Control+a');
		await editor.waitForCrossBlock(true);
		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);

		// Paste the cut content back
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		expect(source).toContain('one');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});
});
