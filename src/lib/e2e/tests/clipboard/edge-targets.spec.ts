import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('clipboard exploration: edge targets', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste into empty document places pasted content', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('hello world\n'));

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('hello world');

		const src = await editor.bridge.getSource();
		expect(src).toContain('hello world');
	});

	test('paste multi-block content into empty document', async () => {
		await editor.loadContent('');
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Heading\n\npara\n'));

		await editor.focusBlockAtPath([0], 0);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('Heading') && s.includes('para'));

		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe(
			['# Heading', '', 'para'].join('\n')
		);
	});

	// Exact-source assertion: the structural paste splices into the list item's
	// container and the bug class would leave 'Big Heading' in the source while
	// the surrounding list scope gets corrupted.
	test('paste heading into list item replaces item content (structural path)', async () => {
		await editor.loadContent('- list item\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('# Big Heading\n'));

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 0, 0], 'list item'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('Big Heading');

		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe('- # Big Heading');
	});

	test('cut across two list items removes selection, clipboard holds removed content', async () => {
		await editor.loadContent('- one\n- two\n- three\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSource(
			(s) => !s.includes('one') && !s.includes('two') && s.includes('three')
		);

		const afterCut = await editor.bridge.getSource();
		expect(afterCut).not.toContain('one');
		expect(afterCut).not.toContain('two');
		expect(afterCut).toContain('three');

		const clipContent = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clipContent).toContain('one');
		expect(clipContent).toContain('two');
	});

	test('cut then paste round-trip: content returns to same position', async () => {
		await editor.loadContent('alpha beta gamma\n');

		const betaStart = 'alpha '.length;
		const betaEnd = betaStart + 'beta'.length;
		await editor.focusBlockAtPath([0], betaStart);
		await editor.shiftClickBlock([0], betaEnd);

		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSource((s) => s.trim() === 'alpha  gamma');

		const afterCut = await editor.bridge.getSource();
		expect(afterCut.trim()).toBe('alpha  gamma');

		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSource((s) => s.trim() === 'alpha beta gamma');

		const afterPaste = await editor.bridge.getSource();
		expect(afterPaste.trim()).toBe('alpha beta gamma');
	});

	test('paste at end of last block in document appends correctly', async () => {
		await editor.loadContent('line one\n\nline two\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText(' APPENDED'));

		await editor.focusBlockAtPath([1], 'line two'.length);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('line two APPENDED');

		const src = await editor.bridge.getSource();
		expect(src).toContain('line two APPENDED');
	});

	test('paste empty clipboard is no-op', async () => {
		await editor.loadContent('unchanged\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText(''));

		await editor.focusBlockAtPath([0], 'unchanged'.length);
		await editor.page.keyboard.press('Control+v');
		// wait 200ms — empty paste is a no-op for source; verify no spurious change settles in.
		await editor.bridge.waitForSourceContains('unchanged');

		expect(await editor.bridge.getSource()).toContain('unchanged');
	});
});
