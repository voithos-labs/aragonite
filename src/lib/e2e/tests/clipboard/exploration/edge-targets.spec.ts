import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

/**
 * Paste / cut into unusual target positions: empty document, thematic
 * break neighbors, start/end of document, mid-list with heterogeneous
 * clipboard content.
 */
test.describe('clipboard exploration: edge targets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste into empty document places pasted content', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('hello world\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('hello world');
	});

	test('paste multi-block content into empty document', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Heading\n\npara\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 0);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('Heading');
		expect(src).toContain('para');
	});

	test('paste heading into list item replaces item content (structural path)', async () => {
		await editor.loadContent('- list item\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Big Heading\n'));
		await editor.page.waitForTimeout(100);

		// Select the list item's text entirely, then paste.
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 0, 0], 'list item'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		expect(src).toContain('Big Heading');
	});

	test('cut across two list items removes selection, clipboard holds removed content', async () => {
		await editor.loadContent('- one\n- two\n- three\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(300);

		const afterCut = await editor.getSource();
		expect(afterCut).not.toContain('one');
		expect(afterCut).not.toContain('two');
		expect(afterCut).toContain('three');

		// Clipboard should hold the cut content.
		const clipContent = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clipContent).toContain('one');
		expect(clipContent).toContain('two');
	});

	test('cut then paste round-trip: content returns to same position', async () => {
		await editor.loadContent('alpha beta gamma\n');

		// Select "beta" in the middle.
		const betaStart = 'alpha '.length;
		const betaEnd = betaStart + 'beta'.length;
		await editor.focusBlockAtPath([0], betaStart);
		await editor.shiftClickBlock([0], betaEnd);

		await editor.pressKey('Control+x');
		await editor.page.waitForTimeout(200);

		const afterCut = await editor.getSource();
		expect(afterCut.trim()).toBe('alpha  gamma');

		// Paste right back at the collapsed caret.
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const afterPaste = await editor.getSource();
		expect(afterPaste.trim()).toBe('alpha beta gamma');
	});

	test('paste at end of last block in document appends correctly', async () => {
		await editor.loadContent('line one\n\nline two\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText(' APPENDED'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([1], 'line two'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		const src = await editor.getSource();
		expect(src).toContain('line two APPENDED');
	});

	test('paste empty clipboard is no-op', async () => {
		await editor.loadContent('unchanged\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText(''));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0], 'unchanged'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(200);

		expect(await editor.getSource()).toContain('unchanged');
	});
});
