import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block paste over selection — single Ctrl+Z', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('3-block selection replaced by 2-block paste — one undo fully restores', async () => {
		const original = 'Alpha\n\nBeta\n\nGamma\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		const pasteMd = 'One\n\nTwo\n';
		await editor.page.evaluate(async (md) => {
			await navigator.clipboard.writeText(md);
		}, pasteMd);

		await editor.page.keyboard.press('Control+v');
		await editor.page.waitForFunction((expected) => {
			return (window as any).__test.getSource().trim() === expected.trim();
		}, pasteMd);

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.bridge.getSource()).trim()).toBe(original.trim());
	});

	test('single-paragraph paste over cross-block selection — one undo restores', async () => {
		const original = '# Heading\n\nPara one\n\nPara two\n';
		await editor.loadContent(original);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');

		await editor.page.evaluate(async () => {
			await navigator.clipboard.writeText('replacement');
		});
		await editor.page.keyboard.press('Control+v');

		await editor.page.waitForFunction(
			() => (window as any).__test.getSource().includes('replacement'),
			null
		);

		await editor.undo();
		await editor.page.waitForFunction(
			(expected) => (window as any).__test.getSource().trim() === expected.trim(),
			original
		);
		expect((await editor.bridge.getSource()).trim()).toBe(original.trim());
	});

	test('cross-block top-level paste of multi-block content is one undo unit', async () => {
		await editor.loadContent('hello\n\nworld\n');
		const before = await editor.bridge.getSource();

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));

		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 'world'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('alpha');

		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');
		expect(afterPaste).not.toContain('hello');
		expect(afterPaste).not.toContain('world');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s, b) => s.trim() === b.trim(), before);
		const afterUndo = await editor.bridge.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});

	test('cross-block paste across list items is one undo unit', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		const before = await editor.bridge.getSource();

		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n'));

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('alpha');

		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste).toContain('alpha');
		expect(afterPaste).toContain('beta');

		await editor.page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceWith((s, b) => s.trim() === b.trim(), before);
		const afterUndo = await editor.bridge.getSource();
		expect(afterUndo.trim()).toBe(before.trim());
	});
});
