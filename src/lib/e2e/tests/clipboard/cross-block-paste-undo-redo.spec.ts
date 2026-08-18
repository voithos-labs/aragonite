import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block paste over selection — undo / redo', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste → Ctrl+Z → Ctrl+Y reproduces the post-paste state', async () => {
		const original = 'Alpha\n\nBeta\n\nGamma\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		const pasteMd = 'One\n\nTwo\n';
		await editor.seedClipboard(pasteMd);
		await editor.paste('Control+v');

		await editor.bridge.waitForSourceWith((s, e) => s.trim() === e.trim(), pasteMd);
		const postPasteSource = (await editor.bridge.getSource()).trim();

		await editor.undo();
		await editor.bridge.waitForSourceWith((s, e) => s.trim() === e.trim(), original);

		await editor.redo();
		await editor.bridge.waitForSourceWith((s, e) => s.trim() === e, postPasteSource);

		expect(await editor.bridge.isCrossBlockSelection()).toBe(false);
	});

	test('single-paragraph paste over cross-block selection — one undo restores', async () => {
		const original = '# Heading\n\nPara one\n\nPara two\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		await editor.seedClipboard('replacement');
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('replacement');

		await editor.undo();
		await editor.bridge.waitForSourceWith((s, e) => s.trim() === e.trim(), original);
	});

	test('cross-block top-level paste of multi-block content is one undo unit', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.bridge.getSource();

		await editor.seedClipboard('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 'world'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('alpha');

		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('hello');
		expect(afterPaste).not.toContain('world');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s, b) => s.trim() === b.trim(), before);
	});

	test('cross-block paste across list items is one undo unit', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		const before = await editor.bridge.getSource();

		await editor.seedClipboard('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('alpha');

		expect(await editor.bridge.getSource()).toContain('beta');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s, b) => s.trim() === b.trim(), before);
	});
});
