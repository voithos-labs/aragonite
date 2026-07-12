import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('copy-paste round-trip: container-matching list paste flattens', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('3-item list, select items 1-2, Ctrl+C+V → original structure', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/1\. one\n2\. two\n3\. three/);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('1. one\n2. two\n3. three');
	});

	test('2-item list, select all, Ctrl+C+V → original structure', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/1\. one\n2\. two/);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('1. one\n2. two');
	});

	test('unordered list round-trip (select 1-2, copy-paste)', async () => {
		await editor.loadContent('- alpha\n- beta\n- gamma\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'beta'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/- alpha\n- beta\n- gamma/);

		const src = await editor.bridge.getSource();
		expect(src.trim()).toBe('- alpha\n- beta\n- gamma');
	});

	test('pasting external list content (pre-staged clipboard) into a list also flattens', async () => {
		await editor.loadContent('- target one\n- target two\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('- pasted a\n- pasted b\n'));

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'target two'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/- pasted a\n- pasted b/);

		const src = await editor.bridge.getSource();
		// Windows clipboard stores CRLF even when written with LF.
		const normalized = src.replace(/\r\n/g, '\n').trim();
		expect(normalized).toBe('- pasted a\n- pasted b');
	});
});
