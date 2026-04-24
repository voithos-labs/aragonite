import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Paste of a list whose ordered flag does not match any ancestor list should
// not land as a nested sub-list. The previous behavior nested the pasted list
// inside the target listItem and placed the trailing slice at item-continuation
// indent, producing a confusing structure. Desired behavior: split the
// enclosing list at the caret and splice the paste between the halves.
test.describe('paste: mismatched-type list into list item breaks out', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered list pasted into the middle of an unordered item splits the list', async () => {
		await editor.loadContent('- Unordered three\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText(
				'1. Ordered first\n2. Ordered second\n3. Ordered third\n'
			)
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 9);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- Unordered$/m);
		expect(src).toMatch(/^1\. Ordered first$/m);
		expect(src).toMatch(/^2\. Ordered second$/m);
		expect(src).toMatch(/^3\. Ordered third$/m);
		expect(src).toMatch(/^- three$/m);
		// Buggy state placed the pasted ordered list at the 2-space item-indent.
		expect(src).not.toMatch(/^ {2,}1\. Ordered first$/m);
		// Buggy state also placed "three" at the 3-space continuation indent.
		expect(src).not.toMatch(/^ {2,}three$/m);
	});

	test('ordered list pasted at the end of an unordered item places paste after it', async () => {
		await editor.loadContent('- Unordered\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('1. a\n2. b\n')
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'Unordered'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- Unordered$/m);
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		// No indentation on the pasted ordered list.
		expect(src).not.toMatch(/^ {2,}1\. a$/m);
	});

	test('ordered list pasted at the start of an unordered item places paste before it', async () => {
		await editor.loadContent('- Unordered\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('1. a\n2. b\n')
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		expect(src).toMatch(/^- Unordered$/m);
		// Pasted ordered list must precede the unordered list.
		expect(src.indexOf('1. a')).toBeLessThan(src.indexOf('- Unordered'));
	});

	test('unordered list pasted into ordered list item also breaks out (symmetry)', async () => {
		await editor.loadContent('1. First target\n');
		await editor.page.evaluate(() =>
			navigator.clipboard.writeText('- paste one\n- paste two\n')
		);
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'First'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. First$/m);
		expect(src).toMatch(/^- paste one$/m);
		expect(src).toMatch(/^- paste two$/m);
		// Continuous numbering across the paste gap: split slot burns one number,
		// second half starts at 2. Matches the exit-paragraph convention.
		expect(src).toMatch(/^2\. target$/m);
		// Buggy nesting would indent the unordered list.
		expect(src).not.toMatch(/^ {2,}- paste one$/m);
	});
});
