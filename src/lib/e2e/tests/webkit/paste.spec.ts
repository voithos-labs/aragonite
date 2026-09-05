import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The WebKit lane's clipboard seam (requirements/webkit/paste.md): these run only under
// `e2e-webkit`, since under Chromium they would re-test the arm the clipboard suite already owns.

test.describe('webkit: paste through the dispatched clipboard event', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('plain text lands at the caret and adds no block', async () => {
		await editor.loadContent('hello world\n');
		await editor.seedClipboard('BRIGHT ');
		await editor.focusBlockAtPath([0], 'hello '.length);

		await editor.paste();
		await editor.bridge.waitForSourceEquals('hello BRIGHT world\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('a two-paragraph payload arrives as blocks, not as one line', async () => {
		await editor.loadContent('target\n');
		await editor.seedClipboard('one\n\ntwo\n');
		await editor.focusBlockEnd(0);

		await editor.paste();
		await editor.bridge.waitForSourceContains('two');
		expect(await editor.bridge.getBlockCount()).toBeGreaterThan(1);
		expect(await editor.bridge.getSource()).toContain('one');
	});

	test('a payload pasted into a list item stays inside the item', async () => {
		await editor.loadContent('- alpha\n');
		await editor.seedClipboard('BETA');
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);

		await editor.paste();
		await editor.bridge.waitForSourceContains('BETA');
		expect(await editor.bridge.getSource()).toBe('- alphaBETA\n');
	});

	test('a cross-block copy round-trips: its bytes paste back at a caret elsewhere', async () => {
		await editor.loadContent('first\n\nsecond\n\ntarget\n');
		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([1], 'second'.length);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardContains('second');

		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await editor.page.keyboard.press('End');
		await editor.paste();

		await editor.bridge.waitForSourceMatches(/target\n\nfirst/);
		const source = await editor.bridge.getSource();
		expect(source.startsWith('first\n\nsecond\n\ntarget\n')).toBe(true);
		expect(source.endsWith('first\n\nsecond')).toBe(true);
	});
});
