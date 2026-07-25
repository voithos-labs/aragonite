import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('text editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of first block does nothing', async () => {
		await editor.loadContent('Only block\n');
		const sourceBefore = await editor.bridge.getSource();

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Backspace');

		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('Backspace at start of heading after heading — no merge, moves focus', async () => {
		await editor.loadContent('# Heading A\n\n## Heading B\n');
		const countBefore = await editor.bridge.getBlockCount();

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');

		const countAfter = await editor.bridge.getBlockCount();
		expect(countAfter).toBe(countBefore);
	});

	test('heading absorbs following paragraph on merge', async () => {
		await editor.loadContent('# Title\n\nBody text\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');

		const source = await editor.bridge.getSource();
		expect(source).toContain('TitleBody text');
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	// The thematic break is a whole-block-focus kind, so a caret-adjacent Backspace
	// focuses it and only a second press deletes — the same two-step the mermaid
	// diagram gets (plugins/mermaid-focus.spec.ts pins the plugin twin).
	test('Backspace after thematic break focuses it, and a second press deletes it', async () => {
		await editor.loadContent('Before\n\n---\n\nAfter\n');
		const original = await editor.bridge.getSource();
		const countBefore = await editor.bridge.getBlockCount();
		const breakBlock = editor.page.locator('.thematic-break-block');

		await editor.focusBlockStart(2);
		await editor.page.keyboard.press('Backspace');

		await expect(breakBlock).toBeFocused();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(original);
		expect(await editor.bridge.getBlockCount()).toBe(countBefore);

		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceNotContains('---');
		expect(await editor.bridge.getBlockCount()).toBeLessThan(countBefore);
	});

	test('kind change reversal — deleting # prefix reverts heading to paragraph', async () => {
		await editor.loadContent('# Title\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Backspace');

		const kind = await editor.bridge.getBlockKind(0);
		expect(kind).toBe('paragraph');
	});

	test('split heading at middle — first stays heading, second becomes paragraph', async () => {
		await editor.loadContent('# HelloWorld\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');

		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('Enter at end of heading — heading unchanged, new empty paragraph', async () => {
		await editor.loadContent('# Heading\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		// Empty block may be absorbed as trivia by the parser — verify via DOM.
		const secondBlock = editor.getBlock(1);
		await expect(secondBlock).toBeVisible();
	});
});
