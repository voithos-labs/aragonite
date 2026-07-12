import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: structural paste discriminator', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('pasting a list at end of paragraph creates list block, no content dropped', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('- foo\n- bar\n'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('foo');
		const source = await editor.bridge.getSource();
		expect(source).toContain('foo');
		expect(source).toContain('bar');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	test('pasting a list inside a list item preserves all pasted items', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		await editor.focusBlockAtPath([0, 0, 0], 'one'.length);
		await editor.page.evaluate(() => navigator.clipboard.writeText('- foo\n- bar\n'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('foo');
		const source = await editor.bridge.getSource();
		expect(source).toContain('foo');
		expect(source).toContain('bar');
		expect(source).toContain('two');
		expect(source).toContain('three');
	});

	test('pasting a heading at end of paragraph creates a heading block', async () => {
		await editor.loadContent('Hello\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => navigator.clipboard.writeText('## A heading\n'));
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('## A heading');
		const source = await editor.bridge.getSource();
		expect(source).toContain('## A heading');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	test('cross-block paste of multi-block content into list items lands content', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('alpha\n\nbeta\n\ngamma\n'));

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('alpha');

		const source = await editor.bridge.getSource();
		expect(source).toContain('alpha');
		expect(source).toContain('beta');
		expect(source).toContain('gamma');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
		expect(source).toContain('three');
	});
});
