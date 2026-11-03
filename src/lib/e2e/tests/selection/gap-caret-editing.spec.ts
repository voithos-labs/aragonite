import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	AT_BOUNDARY,
	CLOSER_BOUNDARY,
	FENCE,
	LAST_CELL,
	TABLE,
	TABLE_THEN_FENCE,
	WINDOWED,
	loadThenArrive
} from './gap-caret-fixtures';
import { clickInPlace } from '../../click-in-place';

// What the gap caret does to the document: creating a block, and the way undo takes back
// (`requirements/selection/gap-caret-editing.md`). The gap itself (what it paints, mode
// changes, the ways out) is `gap-caret-surface.spec.ts`. Bytes are the check here: a boundary
// no editable element can reach is exactly where a separator bug would hide.

/** paragraph, blockquote[paragraph, fencedCode]: the end of the quote's list is boundary 2. */
const QUOTED_FENCE = `para\n\n> quoted\n>\n> \`\`\`\n> code\n> \`\`\`\n`;
const AT_QUOTE_END = { parentPath: [1], index: 2 };

test.describe('minting a paragraph at the gap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing creates a paragraph carrying the text, with the caret after it', async () => {
		await loadThenArrive(editor);

		await editor.typeSlowly('x');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeSlowly('y');

		await editor.bridge.waitForSourceContains('xy');
		expect(await editor.bridge.getSource()).toBe(`para\n\n${TABLE}\nxy\n\n${FENCE}\ntail\n`);
	});

	test('Enter creates an empty paragraph and lands the caret in it', async () => {
		await loadThenArrive(editor);

		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeSlowly('z');

		await editor.bridge.waitForSourceContains('z');
		expect(await editor.bridge.getSource()).toBe(`para\n\n${TABLE}\nz\n\n${FENCE}\ntail\n`);
	});

	// The nested case: the commit runs on the container's own child list, so rebuilding the
	// quote's ancestors must re-prefix the new line. Byte-exact, or the `> ` never lands.
	test('a create at a container scope end lands inside the container', async () => {
		await editor.loadContent(QUOTED_FENCE);
		await editor.focusBlockAtPath([1, 1], CLOSER_BOUNDARY);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(AT_QUOTE_END);

		await editor.typeSlowly('x');

		await editor.bridge.waitForSourceContains('> x');
		expect(await editor.bridge.getSource()).toBe(`${QUOTED_FENCE}>\n> x\n`);
	});

	// A paste lands at the gap as the clipboard's blocks, the caret leaving the gap for them.
	test('a paste at the gap inserts its blocks at the boundary', async () => {
		await loadThenArrive(editor);
		await editor.seedClipboard('pasted\n');

		await editor.paste();

		await editor.bridge.waitForSourceContains('pasted');
		expect(await editor.bridge.getSource()).toBe(
			TABLE_THEN_FENCE.replace(FENCE, `pasted\n\n${FENCE}`)
		);
		expect(await editor.bridge.getGapCaret()).toBeNull();
	});
});

test.describe('undo and redo across a create', () => {
	let editor: EditorPage;

	async function mintAtBoundary(): Promise<void> {
		await loadThenArrive(editor);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');
	}

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('one undo drops the paragraph and puts the caret back in the gap', async () => {
		await mintAtBoundary();

		await editor.undo();

		await editor.bridge.waitForSourceEquals(TABLE_THEN_FENCE);
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
	});

	test('redo brings the paragraph back with the caret in it', async () => {
		await mintAtBoundary();
		await editor.undo();
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.redo();
		await editor.bridge.waitForSourceContains('\nx\n');
		await editor.typeSlowly('y');

		await editor.bridge.waitForSourceContains('xy');
	});

	// The entry below the new block is an ordinary text edit, so the second undo proves the
	// gap's entry did not swallow the stack beneath it.
	test('a second undo carries on past the new block', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.focusBlockStart(0);
		await editor.typeSlowly('EDIT');
		await editor.bridge.waitForSourceContains('EDITpara');
		await clickInPlace(editor.page.locator('.table-cell').nth(LAST_CELL));
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');

		await editor.undo();
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		await editor.undo();

		await editor.bridge.waitForSourceEquals(TABLE_THEN_FENCE);
	});
});

// The unit harness cannot see a windowing flush, so a document long enough to be windowed is
// the only way to check that the restore scrolls the boundary back into view.
test.describe('undo onto a windowed-out boundary', () => {
	const AT_MID = { parentPath: [], index: 101 };

	test('the restore reveals the boundary and puts the caret there', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(WINDOWED);
		expect(await editor.bridge.getBlockKind(100)).toBe('table');

		await page.evaluate(() => (window as any).__test.rects.scrollTo([100]));
		await clickInPlace(page.locator('.table-cell').nth(LAST_CELL));
		await page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_MID);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');

		// Scroll the boundary out of the window, so the restore has something to scroll back.
		await page.evaluate(() => (window as any).__test.rects.scrollTo([0]));
		await editor.waitForRenderFlush();
		await editor.undo();

		await editor.bridge.waitForGapCaret(AT_MID);
		await expect(page.locator('[data-gap-caret]')).toHaveCount(1);
		await expect
			.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-gap-caret]')))
			.toBe(true);
	});
});

test.describe('editor-global chords at the gap', () => {
	test('Mod+Z undoes the previous edit while the caret sits in a gap', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.focusBlockStart(0);
		await editor.typeSlowly('EDIT');
		await editor.bridge.waitForSourceContains('EDITpara');
		await clickInPlace(editor.page.locator('.table-cell').nth(LAST_CELL));
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.undo();

		await editor.bridge.waitForSourceEquals(TABLE_THEN_FENCE);
	});
});
