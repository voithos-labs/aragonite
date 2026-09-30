import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	PARAGRAPH,
	PNG,
	getCalls,
	gotoWithHook,
	pasteFiles,
	releaseImport,
	setResponses
} from './image-paste-harness';

// The cross-block path owns the delete and the insert as one undo entry and addresses by path,
// so which element received the event does not change where it lands. See
// `requirements/clipboard/image-paste-cross-block.md`.

const THREE_PARAGRAPHS = `${PARAGRAPH}\nsecond\n\nthird\n`;

test.describe('image paste: cross-block replacement', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = await gotoWithHook(page);
	});

	/** Anchor at the end of block 0, focus two blocks down. */
	async function selectThreeBlocks(page: import('@playwright/test').Page): Promise<void> {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
	}

	test('the selection is replaced, and the next gesture is sound', async ({ page }) => {
		await editor.loadContent(THREE_PARAGRAPHS);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await selectThreeBlocks(page);
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('shot.png');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('second');
		expect(source.trim()).toBe('AB![[shot.png]]third');
		await editor.bridge.waitForBlockCount(1);

		// The delete has to have collapsed the selection: otherwise the next gesture
		// acts on a range whose offsets shifted by the inserted length.
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('![[shot.png]]Xthird');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('the whole replacement is one undo entry', async ({ page }) => {
		await editor.loadContent(THREE_PARAGRAPHS);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await selectThreeBlocks(page);
		await pasteFiles(page, [PNG]);
		await editor.bridge.waitForSourceContains('shot.png');

		// The replacement must be established before undoing it, or a build that inserted without
		// deleting would satisfy every assertion below.
		expect((await editor.bridge.getSource()).trim()).toBe('AB![[shot.png]]third');
		await editor.bridge.waitForBlockCount(1);

		// One undo takes back the delete and the insertion together, or the user is left with the
		// selection gone and no image.
		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceNotContains('shot.png');
		const restored = await editor.bridge.getSource();
		expect(restored).toContain('second');
		expect(restored).toContain('third');
		await editor.bridge.waitForBlockCount(3);
	});

	// `isCrossBlock` is read when the import arrives, so what gets replaced is whatever is
	// selected then. The within-block branch is deliberately different: it anchors at paste time.
	test('a selection made while the import is in flight is the one replaced', async ({ page }) => {
		await editor.loadContent(THREE_PARAGRAPHS);
		await setResponses(page, [{ markdown: '![[held.png]]', hold: true }]);
		await editor.focusBlockEnd(0);
		await pasteFiles(page, [{ name: 'held.png', type: 'image/png' }]);
		await expect.poll(async () => (await getCalls(page)).length).toBe(1);

		// The user extends a multi-block selection while the host is still uploading.
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await releaseImport(page);

		await editor.bridge.waitForSourceContains('held.png');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('second');
		expect(source.trim()).toBe('AB![[held.png]]third');
		expect(await editor.parseConverged()).toBe(true);
	});

	// An image-only focus endpoint leaves the caret write nowhere to go, so Chromium dispatches at
	// `<body>` and the editor-root fallback runs, which must not drop a pure-image paste.
	test('an image pasted over a selection ending in an image block is imported', async ({
		page
	}) => {
		await editor.loadContent(`${PARAGRAPH}\nsecond\n\n![cat](/test-fixtures/sample.png)\n`);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await pasteFiles(page, [PNG], '', 'body');

		await editor.bridge.waitForSourceContains('shot.png');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('second');
		expect(source).not.toContain('sample.png');
		expect(await getCalls(page)).toHaveLength(1);
		expect(await editor.parseConverged()).toBe(true);
	});

	// The cross-block delete has a table branch, so a cell-anchored selection is its own shape,
	// checked against the same string pasted as text: the image must take the cross-block route.
	test('a selection anchored in a table cell is replaced, exactly as a text paste would', async ({
		page
	}) => {
		const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntrailing\n';
		const MARKDOWN = '![[shot.png]]';
		const selectOutOfCell = async () => {
			await page.locator('.table-cell').nth(2).click();
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
		};

		await editor.loadContent(TABLE);
		await setResponses(page, [{ markdown: MARKDOWN }]);
		await selectOutOfCell();
		await pasteFiles(page, [PNG]);
		await editor.bridge.waitForSourceContains('shot.png');

		const viaHook = await editor.bridge.getSource();
		// The covered body row is gone; the range really was deleted.
		expect(viaHook).not.toContain('| 1 | 2 |');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect(await editor.parseConverged()).toBe(true);

		// A fresh navigation, not a second `loadContent`: the harness drives `source` as a prop, so the
		// string it already holds would change nothing.
		await editor.goto('?imagePaste=on');
		await editor.loadContent(TABLE);
		await selectOutOfCell();
		await editor.seedClipboard(MARKDOWN);
		await editor.paste();
		await editor.bridge.waitForSourceContains('shot.png');

		expect(await editor.bridge.getSource()).toBe(viaHook);
	});
});
