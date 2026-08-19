import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: paste basics', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+V with cross-block selection deletes range and pastes', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.seedClipboard('PASTED');
		await editor.paste();
		await editor.bridge.waitForSourceContains('PASTED');
		expect(await editor.bridge.getSource()).toContain('aaa');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('multi-block paste with single-block selection is one undo unit', async () => {
		await editor.loadContent('hello world\n');
		await editor.seedClipboard('alpha\n\nbeta\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.paste();
		await editor.bridge.waitForSourceContains('alpha');
		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('world');

		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceWith((s) => s.trim() === 'hello world', null);
	});
});

test.describe('cross-block clipboard: multi-block paste at single caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Exact-source assertions catch structural-paste misroutes that leave the
	// substrings the original waitForSourceContains checks intact while the
	// surrounding splice rots.
	test('pasting two paragraphs creates multiple blocks', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard('# Heading\n\nNew paragraph\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('# Heading');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['Hello', '', '# Heading', '', 'New paragraph'].join('\n')
		);
		// The live tree holds what the bytes reparse to: the clipboard's internal blank line
		// separates rather than minting a row (see paste-blank-line-parity).
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});

	test('multi-block paste replaces selected text', async () => {
		await editor.loadContent('Hello World\n');
		await editor.focusBlock(0, 6);
		for (let i = 0; i < 5; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
		await editor.seedClipboard('First\n\nSecond');
		await editor.paste();
		await editor.bridge.waitForSourceContains('Second');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['Hello ', '', 'First', '', 'Second'].join('\n')
		);
	});
});

test.describe('cross-block clipboard: structural paste discriminator', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting a list at end of paragraph creates list block, no content dropped', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard('- foo\n- bar\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('foo');
		expect(await editor.bridge.getSource()).toContain('bar');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	test('pasting a list inside a list item preserves all pasted items', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		await editor.focusBlockAtPath([0, 0, 0], 'one'.length);
		await editor.seedClipboard('- foo\n- bar\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('foo');
		const source = await editor.bridge.getSource();
		expect(source).toContain('bar');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});

	test('pasting a heading at end of paragraph creates a heading block', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard('## A heading\n');
		await editor.paste();
		await editor.bridge.waitForSourceContains('## A heading');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});
});
