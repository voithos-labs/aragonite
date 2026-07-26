import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import {
	PARAGRAPH,
	PNG,
	getCalls,
	gotoWithHook,
	parseConverged,
	pasteFiles,
	releaseImport,
	setResponses
} from './image-paste-harness';

// An image paste replaces a multi-block selection like every other paste route. The
// cross-block seam owns the delete + insert as one undo entry and addresses by path,
// so the surface that received the event is irrelevant to where it lands. See
// requirements/clipboard/image-paste-cross-block.md.

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
		expect(await parseConverged(page)).toBe(true);
	});

	test('the whole replacement is one undo entry', async ({ page }) => {
		await editor.loadContent(THREE_PARAGRAPHS);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await selectThreeBlocks(page);
		await pasteFiles(page, [PNG]);
		await editor.bridge.waitForSourceContains('shot.png');

		// Establish that the replacement actually happened before undoing it — without
		// this, a build that inserted without deleting would satisfy every assertion
		// below and the undo claim would be vacuous.
		expect((await editor.bridge.getSource()).trim()).toBe('AB![[shot.png]]third');
		await editor.bridge.waitForBlockCount(1);

		// ONE press has to undo the delete AND the insertion together — otherwise the
		// user is left staring at a document whose selection is gone and whose image
		// never arrived.
		await page.keyboard.press(`${primaryModifier}+z`);
		await editor.bridge.waitForSourceNotContains('shot.png');
		const restored = await editor.bridge.getSource();
		expect(restored).toContain('second');
		expect(restored).toContain('third');
		await editor.bridge.waitForBlockCount(3);
	});

	// The branch reads `isCrossBlock` LIVE, because the seam it delegates to resolves
	// endpoints by path at call time. So the selection that gets replaced is whatever
	// is active when the import LANDS, not when the paste fired — the deliberate
	// asymmetry with the intra-block branch's paste-time anchor.
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
		expect(await parseConverged(page)).toBe(true);
	});

	// The cross-block delete has a table-specific branch (cell-index endpoints, the
	// whole-row snap), so a selection anchored in a cell is its own shape. Asserted
	// against the SAME string pasted as text over the SAME selection: the arm has to
	// inherit the cross-block route, not place anything itself.
	test('a selection anchored in a table cell is replaced, exactly as a text paste would', async ({
		page
	}) => {
		const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntrailing\n';
		const MARKDOWN = '![[shot.png]]';
		const selectOutOfCell = async () => {
			await page.locator('[role="cell"]').nth(2).click();
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
		expect(await parseConverged(page)).toBe(true);

		// Same document, same selection, same string — pasted as text. No image files on
		// the clipboard, so the arm declines and the ordinary route runs. A fresh
		// navigation, not a second loadContent: the harness drives `source` as a prop, so
		// re-assigning the string it already holds is a no-op and would leave the mutated
		// document in place.
		await editor.goto('?imagePaste=on');
		await editor.loadContent(TABLE);
		await selectOutOfCell();
		await page.evaluate((md) => navigator.clipboard.writeText(md), MARKDOWN);
		await page.keyboard.press(`${primaryModifier}+v`);
		await editor.bridge.waitForSourceContains('shot.png');

		expect(await editor.bridge.getSource()).toBe(viaHook);
	});
});
