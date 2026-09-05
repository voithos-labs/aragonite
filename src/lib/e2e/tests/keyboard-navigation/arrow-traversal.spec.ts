import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { SIMPLE_CONTENT } from '../../test-content';

test.describe('keyboard navigation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown at end of block moves focus to next block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('XSecond paragraph');
	});

	test('ArrowUp at start of block moves focus to previous block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Y');
		await editor.bridge.waitForSourceContains('YFirst paragraph.');
	});

	test('ArrowDown at end of last block creates new paragraph', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		const countBefore = await editor.getDomBlockCount();
		const lastIndex = countBefore - 1;
		await editor.focusBlockEnd(lastIndex);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Z');

		const countAfter = await editor.getDomBlockCount();
		expect(countAfter).toBe(countBefore + 1);
	});

	test('ArrowUp at start of first block does nothing', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('A');
		// Anchored to the start of the source: a caret ArrowUp moved to END of block satisfies a
		// bare `contains`, which is the regression this predicate rules out.
		await editor.bridge.waitForSource((s) => s.startsWith('AFirst paragraph'));
	});

	// A heading's own marker span is its first child, so the first-visual-line check reads
	// geometry rather than a text node — the arrival paragraphs never exercise.
	test('ArrowUp at the top of a block moves into the heading above', async () => {
		await editor.loadContent('# Title\n\nParagraph text.\n');

		await editor.focusBlock(1, 0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!# Title');
	});

	test('ArrowDown into container block enters first child', async () => {
		await editor.loadContent('Before\n\n> Inside quote\n');

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Q');
		await editor.bridge.waitForSourceMatches(/> .*Inside quoteQ|> .*QInside quote/);
	});

	test('ArrowUp out of container block exits to block before', async () => {
		await editor.loadContent('Above\n\n> Quote content\n');

		const bqEditable = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('B');
		await editor.bridge.waitForSourceMatches(/^[^>].*B/m);
	});

	test('ArrowDown on empty block moves to the next block', async () => {
		await editor.loadContent('Above.\n\nBelow.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3);

		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('XBelow.');
	});

	test('navigate down through multiple blocks and type in final', async () => {
		await editor.loadContent('Block one.\n\nBlock two.\n\nBlock three.\n');

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.page.keyboard.press('ArrowDown');

		await editor.page.keyboard.press('End');
		await editor.typeText('!');
		await editor.bridge.waitForSource(
			(s) => s.includes('Block two.!') || s.includes('Block three.!')
		);
	});

	test('navigate up then type at start of first block', async () => {
		await editor.loadContent('Hello.\n\nWorld.\n');

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('hi ');
		await editor.bridge.waitForSourceContains('hi Hello.');
	});
});
