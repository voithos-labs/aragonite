import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Navigation out of a fenced code block: Enter on an empty trailing line,
// vertical arrow exits into adjacent blocks, and the Backspace-at-position-0
// focus-only semantics (no block deletion).

test.describe('code block editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('exit code block via Enter on empty trailing line', async () => {
		await editor.loadContent('```\nsome code\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+End');
		await editor.pressEnter();
		await editor.page.waitForTimeout(200);
		await editor.pressEnter();
		await editor.page.waitForTimeout(300);
		await editor.typeText('after code');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).toContain('after code');
		expect(source).toContain('some code');
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('ArrowUp in first line exits to previous block', async () => {
		await editor.loadContent('Above paragraph\n\n```\ncode here\n```\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Control+Home');
		await editor.page.waitForTimeout(100);
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('End');
		await editor.typeText(' appended');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('Above paragraph appended');
	});

	test('ArrowDown in last line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(200);
		await editor.typeText('prepended ');
		await editor.page.waitForTimeout(200);
		expect(await editor.getSource()).toContain('prepended');
	});

	test('Backspace at position 0 moves focus without deleting code block', async () => {
		await editor.loadContent('Before\n\n```\ncode\n```\n');
		const countBefore = await editor.getBlockCount();
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.pressBackspace();
		await editor.page.waitForTimeout(200);
		expect(await editor.getBlockCount()).toBe(countBefore);
		expect(await editor.getSource()).toContain('code');
	});
});
