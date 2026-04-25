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
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Enter');
		await editor.page.waitForTimeout(300);
		await editor.typeText('after code');
		await editor.bridge.waitForSourceContains('after code');
		const source = await editor.bridge.getSource();
		expect(source).toContain('after code');
		expect(source).toContain('some code');
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('ArrowUp in first line exits to previous block', async () => {
		await editor.loadContent('Above paragraph\n\n```\ncode here\n```\n');
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Control+Home');
		await editor.page.waitForTimeout(100);
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('End');
		await editor.typeText(' appended');
		await editor.bridge.waitForSourceContains('Above paragraph appended');
		expect(await editor.bridge.getSource()).toContain('Above paragraph appended');
	});

	test('ArrowDown in last line exits to next block', async () => {
		await editor.loadContent('```\ncode here\n```\n\nBelow paragraph\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.waitForTimeout(200);
		await editor.typeText('prepended ');
		await editor.bridge.waitForSourceContains('prepended');
		expect(await editor.bridge.getSource()).toContain('prepended');
	});

	test('Backspace at position 0 moves focus without deleting code block', async () => {
		await editor.loadContent('Before\n\n```\ncode\n```\n');
		const countBefore = await editor.bridge.getBlockCount();
		await editor.getBlock(1).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForTimeout(200);
		expect(await editor.bridge.getBlockCount()).toBe(countBefore);
		expect(await editor.bridge.getSource()).toContain('code');
	});
});
