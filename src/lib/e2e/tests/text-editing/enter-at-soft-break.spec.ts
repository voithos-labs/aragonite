import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// GH #95: the caret at the end of a soft-broken line sits ON the paragraph's internal line
// ending, and Enter there destroyed every line below it. Requirements: enter-at-soft-break.md.

test.describe('text editing — Enter at a soft line break', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// End-of-first-line and start-of-second are the same document position reached by
	// different keys, so both must split identically.
	for (const [where, offset] of [
		['at the end of the first line', 3],
		['at the start of the second line', 4]
	] as const) {
		test(`Enter ${where} splits the paragraph and keeps the line below`, async () => {
			await editor.loadContent('aaa\nbbb\n');
			await editor.focusBlockAtPath([0], offset);
			await editor.page.keyboard.press('Enter');
			await editor.waitForBlockHostCount(2);

			await editor.bridge.waitForSourceEquals('aaa\n\nbbb\n');
			expect(await editor.parseConverged()).toBe(true);

			const selection = await editor.bridge.getSelectionPaths();
			expect(selection?.focus).toEqual({ path: [1], offset: 0 });
		});
	}

	test('Enter on the first of two soft breaks keeps both following lines', async () => {
		await editor.loadContent('aaa\nbbb\nccc\n');
		await editor.focusBlockAtPath([0], 3);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.bridge.waitForSourceEquals('aaa\n\nbbb\nccc\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('real click + End + Enter — typing lands at the head of the surviving second half', async () => {
		await editor.loadContent('aaa\nbbb\n');
		await editor.clickBlockAtPath([0], 1);
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('X');
		await editor.bridge.waitForSourceEquals('aaa\n\nXbbb\n');
	});
});
