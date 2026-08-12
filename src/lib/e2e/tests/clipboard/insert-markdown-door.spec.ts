import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// editor.insertMarkdown() — the paste pipeline entered without a clipboard
// (requirements/clipboard/insert-markdown-door.md). Each case asserts the outcome the same
// bytes pasted at the same caret produce, since the door's whole contract is that parity.

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

test.describe('insertMarkdown — programmatic insertion', () => {
	let editor: EditorPage;

	const insert = (md: string): Promise<boolean> =>
		editor.page.evaluate((text) => (window as any).__test.insertMarkdown(text) as boolean, md);

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a table at a paragraph caret splices structurally, focus at the end of the insertion', async () => {
		await editor.loadContent('before\n\nafter\n');
		await editor.focusBlockEnd(0);

		expect(await insert(TABLE)).toBe(true);
		await editor.bridge.waitForSourceContains('| --- | --- |');
		expect(await editor.bridge.getBlockKind(1)).toBe('table');

		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/\| 1 \| 2X \|/);
	});

	test('a single-line snippet mid-paragraph splices inline at the caret offset', async () => {
		await editor.loadContent('alphabeta\n');
		await editor.focusBlock(0, 'alpha'.length);

		expect(await insert('**bold**')).toBe(true);
		await editor.bridge.waitForSourceContains('alpha**bold**beta');
		expect(await editor.bridge.getBlockCount()).toBe(1);

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('alpha**bold**Zbeta');
	});

	test('list items inserted inside a same-type list absorb as siblings', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);

		expect(await insert('- x\n- y\n')).toBe(true);
		await editor.bridge.waitForSourceMatches(/^- y$/m);

		const source = (await editor.bridge.getSource()).replace(/\r\n/g, '\n');
		expect(source.match(/^- .*$/gm)).toEqual(['- alpha', '- x', '- y', '- beta']);
	});

	test('a cross-block selection is replaced, and one undo restores both halves', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlock(0, 'alp'.length);
		await editor.shiftClickBlock([1], 'be'.length);
		await editor.waitForCrossBlock(true);

		expect(await insert('MID')).toBe(true);
		await editor.bridge.waitForSourceContains('alpMIDta');
		expect(await editor.bridge.getBlockCount()).toBe(1);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
	});

	// A widget-only paragraph seats no native selection, so the BROWSER dispatches its clipboard
	// events at <body> — but the block still holds DOM focus, which is what the door resolves
	// from, so it must reach the same widget-replace branch the paste tail takes.
	test('a selected inline widget is replaced, as pasting over it does', async () => {
		await editor.loadContent('lead\n\n![cat](/test-fixtures/sample.png)\n\ntail\n');
		await editor.page.locator('[data-image-widget]').click();
		await expect(editor.page.locator('[data-image-overlay]')).toBeVisible();

		expect(await insert('REPLACED')).toBe(true);
		await editor.bridge.waitForSourceContains('REPLACED');
		expect(await editor.bridge.getSource()).not.toContain('sample.png');
		expect(await editor.bridge.getBlockCount()).toBe(3);
	});

	test('a registered paste transform rewrites the inserted text', async () => {
		await editor.page.evaluate(() =>
			(window as any).__test.registerPasteTransform('e2e-insert-door', '@@STAMP@@', 'stamped')
		);
		await editor.loadContent('note:\n');
		await editor.focusBlockEnd(0);

		expect(await insert(' @@STAMP@@')).toBe(true);
		await editor.bridge.waitForSourceContains('note: stamped');
		expect(await editor.bridge.getSource()).not.toContain('@@STAMP@@');
	});
});
