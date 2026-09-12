import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';

// Editing keys at the edges of a revealed `$$` source whose fence lines live mode hides: the
// line extremes, Enter, Backspace and Tab must all stay inside the body.
// Requirements: e2e/requirements/plugins/latex-block-live-editing.md.

const BODY = '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}';
const DOC = `Before\n\n$$\n${BODY}\n$$\n\nAfter\n`;

test.describe('block math editing edges (live)', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock-multiline');
		await editor.setPresentationMode('live');
	});

	const enterFromAbove = async (page: BlockMathPage['page']) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.source).toBeFocused();
	};

	const enterFromBelow = async (page: BlockMathPage['page']) => {
		await editor.getBlock(2).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(editor.source).toBeFocused();
	};

	test('Home on the first body line seats at its column 0, not before the hidden opener', async ({
		page
	}) => {
		await enterFromAbove(page);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Home');
		await page.keyboard.type('X');
		await expect.poll(() => editor.sourceText()).toBe(`$$\nX${BODY}\n$$`);
	});

	test('End on the last body line seats after its last byte, not past the hidden closer', async ({
		page
	}) => {
		await enterFromBelow(page);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('End');
		await page.keyboard.type('X');
		await expect.poll(() => editor.sourceText()).toBe(`$$\n${BODY}X\n$$`);
	});

	test('Enter at the body end opens a line inside the fence, and the blur commits it', async ({
		page
	}) => {
		await enterFromBelow(page);
		await page.keyboard.press('Enter');
		await page.keyboard.type('X');
		await expect.poll(() => editor.sourceText()).toBe(`$$\n${BODY}\nX\n$$`);

		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceEquals(`Before\n\n$$\n${BODY}\nX\n$$\n\nAfter\n`);
	});

	test('Backspace at the body start deletes nothing and keeps the fence', async ({ page }) => {
		await enterFromAbove(page);
		await page.keyboard.press('Backspace');
		await expect.poll(() => editor.sourceText()).toBe(`$$\n${BODY}\n$$`);

		await editor.getBlock(2).click();
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(DOC);
	});

	test('Delete at the body end deletes nothing and keeps the fence', async ({ page }) => {
		await enterFromBelow(page);
		await page.keyboard.press('Delete');
		await expect.poll(() => editor.sourceText()).toBe(`$$\n${BODY}\n$$`);

		await editor.getBlock(0).click();
		expect(await editor.bridge.getSource()).toBe(DOC);
	});

	// Parity with prose: no built-in binds Tab, so it is the browser's focus step out of the
	// block, and the leaf folds on the blur it causes, committing the draft whole.
	test('Tab leaves the block as it leaves a paragraph, and the draft commits whole', async ({
		page
	}) => {
		await enterFromAbove(page);
		await page.keyboard.type('X');
		await page.keyboard.press('Tab');

		await expect(editor.source).toHaveCount(0);
		await editor.bridge.waitForSourceEquals(`Before\n\n$$\nX${BODY}\n$$\n\nAfter\n`);
	});
});
