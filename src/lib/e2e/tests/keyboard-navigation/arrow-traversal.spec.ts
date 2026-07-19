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

		const source = await editor.bridge.getSource();
		expect(source).toContain('XSecond paragraph');
	});

	test('ArrowUp at start of block moves focus to previous block', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('Y');
		await editor.bridge.waitForSourceContains('YFirst paragraph.');

		const source = await editor.bridge.getSource();
		expect(source).toContain('YFirst paragraph.');
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
		const source = await editor.bridge.getSource();
		expect(source).toContain('Z');
	});

	test('ArrowUp at start of first block does nothing', async () => {
		await editor.loadContent(SIMPLE_CONTENT);

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('A');
		await editor.bridge.waitForSource((s) => s.startsWith('AFirst paragraph'));

		// Pre-tightened, this regex accepted the regression case where ArrowUp
		// moved the caret to end-of-block. Anchor to start-of-source.
		const source = await editor.bridge.getSource();
		expect(source.startsWith('AFirst paragraph')).toBe(true);
	});

	test('ArrowDown into container block enters first child', async () => {
		await editor.loadContent('Before\n\n> Inside quote\n');

		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Q');
		await editor.bridge.waitForSourceMatches(/> .*Inside quoteQ|> .*QInside quote/);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/> .*Inside quoteQ|> .*QInside quote/);
	});

	test('ArrowUp out of container block exits to block before', async () => {
		await editor.loadContent('Above\n\n> Quote content\n');

		const bqEditable = editor.getBlock(1).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('B');
		await editor.bridge.waitForSourceMatches(/^[^>].*B/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^[^>].*B/m);
	});

	test('ArrowDown on empty block moves to the next block', async () => {
		await editor.loadContent('Above.\n\nBelow.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3);

		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('XBelow.');
		const source = await editor.bridge.getSource();
		expect(source).toContain('XBelow.');
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

		const source = await editor.bridge.getSource();
		const hasExcl = source.includes('Block two.!') || source.includes('Block three.!');
		expect(hasExcl).toBe(true);
	});

	test('navigate up then type at start of first block', async () => {
		await editor.loadContent('Hello.\n\nWorld.\n');

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('ArrowUp');
		await editor.typeText('hi ');
		await editor.bridge.waitForSourceContains('hi Hello.');

		const source = await editor.bridge.getSource();
		expect(source).toContain('hi Hello.');
	});
});
