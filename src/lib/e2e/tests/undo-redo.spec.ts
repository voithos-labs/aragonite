import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { SIMPLE_CONTENT } from '../test-content';

test.describe('undo and redo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SIMPLE_CONTENT);
	});

	test('undo reverts a split (Enter then Ctrl+Z restores single block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		expect(await editor.getDomBlockCount()).toBeGreaterThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('redo restores a split after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		const splitSource = await editor.bridge.getSource();
		const splitCount = await editor.getDomBlockCount();

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(3);

		await editor.redo();
		expect(await editor.bridge.getSource()).toBe(splitSource);
		expect(await editor.getDomBlockCount()).toBe(splitCount);
	});

	test('undo reverts typed text after debounce', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' extra words');
		await editor.bridge.waitForSourceContains(' extra words');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('undo reverts a merge (Backspace at start of block)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');
		expect(await editor.getDomBlockCount()).toBeLessThan(3);

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await editor.getDomBlockCount()).toBe(3);
	});

	test('undo reverts kind change (paragraph to heading via # prefix)', async () => {
		const before = await editor.bridge.getSource();
		await editor.focusBlockStart(0);
		await editor.typeSlowly('# ');
		await editor.bridge.waitForSourceMatches(/^# /m);
		await editor.waitForUndoBatchFlush();
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');

		await editor.undo();
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('undo across a paragraph→htmlBlock flip restores the rendered DOM, not just the source', async () => {
		// The block starts as the paragraph '<di'. Typing 'v' makes '<div', which
		// reparses to an htmlBlock in the same (non-prose) render path — and the
		// browser has already inserted the char, so the DOM matches the display
		// before the render runs. Undo returns the paragraph, and the DOM must
		// follow the CST. Asserting source alone passes while the bug is live (the
		// CST is correct after undo); only the rendered DOM goes stale, so the next
		// keystroke would commit the undone byte back.
		await editor.loadContent('<di\n');
		await editor.focusBlockEnd(0);
		await editor.typeText('v');
		await editor.bridge.waitForSourceContains('<div');
		await editor.waitForUndoBatchFlush();
		expect(await editor.bridge.getBlockKind(0)).toBe('htmlBlock');

		await editor.undo();
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.getBlockText(0)).toBe('<di');

		// The undone byte must not resurrect through the next keystroke's readback.
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		await editor.bridge.waitForSourceContains('z');
		expect(await editor.bridge.getSource()).not.toContain('div');
	});

	test('multiple undo steps revert a sequence of operations', async () => {
		const original = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' appended');
		await editor.bridge.waitForSourceContains(' appended');
		await editor.waitForUndoBatchFlush();

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		await editor.undo();
		await editor.undo();

		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('redo stack is cleared when a new edit occurs after undo', async () => {
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		const splitSource = await editor.bridge.getSource();

		await editor.undo();
		await editor.focusBlockEnd(0);
		await editor.typeText('x');
		await editor.bridge.waitForSourceContains('x');
		await editor.waitForUndoBatchFlush();

		await editor.redo();
		expect(await editor.bridge.getSource()).not.toBe(splitSource);
	});

	test('undo on empty stack does not crash or corrupt state', async () => {
		const before = await editor.bridge.getSource();
		await editor.undo();
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(before);
		await editor.focusBlockEnd(0);
		await editor.typeText('z');
		expect(await editor.getBlockText(0)).toContain('z');
	});
});
