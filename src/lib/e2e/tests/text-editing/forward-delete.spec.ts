import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';

test.describe('forward delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Delete at end of block merges with next', async () => {
		await editor.loadContent('# Hello\n\nWorld\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceContains('# HelloWorld');
		const source = await editor.bridge.getSource();
		expect(source).toContain('# HelloWorld');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('Delete in middle of block works normally', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceContains('Helloworld');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Helloworld');
	});

	// Forward twin of the Backspace two-step (text-editing/edge-cases.spec.ts): the
	// thematic break takes whole-block focus first, and deletes on the second press.
	test('Delete before thematic break focuses it, and a second press removes it', async () => {
		await editor.loadContent('Hello\n\n---\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		const original = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');

		await expect(wholeBlockInput(editor.page.locator('.thematic-break-block'))).toBeFocused();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(original);

		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForBlockCount(1);
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('Delete before non-mergeable heading moves focus', async () => {
		await editor.loadContent('# First\n\n# Second\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Delete');
		// Type a marker afterward to flush any async edit Delete might trigger;
		// a successful merge would collapse to 1 block and the assertion would surface it.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});
});
