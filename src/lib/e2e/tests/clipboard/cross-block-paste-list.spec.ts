// One invariant — paste replacement — parametrized across the selection shapes that span
// list items, which is why these stay in one file.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('cross-block clipboard: paste into list selections', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste into cross-block selection spanning two items within a list', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.seedClipboard('HELLO');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource(
			(s) => s.includes('HELLO') && !s.includes('one') && !s.includes('two')
		);
	});

	test('paste into cross-block selection covering two of three list items', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.seedClipboard('HELLO');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('HELLO') && !s.includes('one'));

		const source = await editor.bridge.getSource();
		expect(source).toContain('HELLO');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
		expect(source).toContain('three');
	});

	test('paste into cross-block selection covering items 2 and 3 of a 3-item list', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.seedClipboard('HELLO');

		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 'three'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('HELLO') && !s.includes('two'));

		const source = await editor.bridge.getSource();
		expect(source).toContain('one');
		expect(source).toContain('HELLO');
		expect(source).not.toContain('two');
		expect(source).not.toContain('three');
	});

	test('paste MULTI-BLOCK content into cross-block selection spanning two list items', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.seedClipboard('alpha\n\nbeta\n');

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.shiftClickBlock([0, 1, 0], 'two'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('alpha') && s.includes('beta'));

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
	});

	test('copy across list items, paste across list items reinserts content', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		// Dismiss the copy-time cross-block selection so the next shift-click
		// starts a fresh range instead of extending the old one.
		await editor.page.keyboard.press('Escape');
		await editor.waitForCrossBlock(false);
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await editor.shiftClickBlock([0, 2, 0], 5);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('ne') && s.includes('tw'));

		const source = await editor.bridge.getSource();
		expect(source).toContain('ne');
		expect(source).toContain('tw');
		expect(source).toMatch(/\bone\b/);
	});

	// Regression: drag selection leaves the native selection empty, so Chromium
	// dispatched paste to <body> instead of any block. Fixed by parking a
	// collapsed caret in the focus block when entering cross-block.
	test('drag selection across list items: paste single-block text lands', async () => {
		await editor.loadContent('1. one\n2. two\n');
		await editor.seedClipboard('text');

		await editor.dragFromTo([0, 0, 0], 0, [0, 1, 0], 3);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSource((s) => s.includes('text') && !s.includes('one'));

		const source = await editor.bridge.getSource();
		expect(source).toContain('text');
		expect(source).not.toContain('one');
		expect(source).not.toContain('two');
	});

	test('paste into cross-block selection with mid-paragraph offsets in two list items', async () => {
		await editor.loadContent('1. one\n2. two\n');

		await editor.seedClipboard('HELLO');

		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.shiftClickBlock([0, 1, 0], 2);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceMatches(/^1\. oHELLOo$/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. oHELLOo$/m);
	});

	test('paste into cross-block selection covering entire list replaces it', async () => {
		await editor.loadContent('Before list\n\n- Item one\n- Item two\n- Item three\n\nAfter list\n');

		await editor.seedClipboard('REPLACEMENT');

		await editor.focusBlockAtPath([1, 0, 0], 0);
		await editor.shiftClickBlock([1, 2, 0], 'Item three'.length);
		await editor.waitForCrossBlock(true);

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('REPLACEMENT');

		const source = await editor.bridge.getSource();

		expect(source).toContain('Before list');
		expect(source).toContain('REPLACEMENT');
		expect(source).toContain('After list');
		expect(source).not.toContain('Item one');
		expect(source).not.toContain('Item two');
		expect(source).not.toContain('Item three');
	});
});
