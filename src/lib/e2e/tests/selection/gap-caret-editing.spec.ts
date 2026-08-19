import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
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

// What the gap caret does to the DOCUMENT: minting, and the undo road back
// (requirements/selection/gap-caret-editing.md). The surface itself — paint, mode flips,
// the ways out — is gap-caret-surface.spec.ts. Bytes are the oracle here: a boundary the
// editing surfaces cannot reach is exactly where a separator bug would hide.

/** paragraph, blockquote[paragraph, fencedCode] — the quote's scope end is boundary 2. */
const QUOTED_FENCE = `para\n\n> quoted\n>\n> \`\`\`\n> code\n> \`\`\`\n`;
const AT_QUOTE_END = { parentPath: [1], index: 2 };

test.describe('minting a paragraph at the gap', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing mints a paragraph carrying the text, with the caret after it', async () => {
		await loadThenArrive(editor);

		await editor.typeSlowly('x');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeSlowly('y');

		await editor.bridge.waitForSourceContains('xy');
		expect(await editor.bridge.getSource()).toBe(`para\n\n${TABLE}\nxy\n\n${FENCE}\ntail\n`);
	});

	test('Enter mints an empty paragraph and lands the caret in it', async () => {
		await loadThenArrive(editor);

		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeSlowly('z');

		await editor.bridge.waitForSourceContains('z');
		expect(await editor.bridge.getSource()).toBe(`para\n\n${TABLE}\nz\n\n${FENCE}\ntail\n`);
	});

	// The nested arm: the commit runs on the container's own scope, so the quote's ancestry
	// rebuild must re-prefix the minted line. Byte-exact, or the `> ` never lands.
	test('a mint at a container scope end lands inside the container', async () => {
		await editor.loadContent(QUOTED_FENCE);
		await editor.focusBlockAtPath([1, 1], CLOSER_BOUNDARY);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(AT_QUOTE_END);

		await editor.typeSlowly('x');

		await editor.bridge.waitForSourceContains('> x');
		expect(await editor.bridge.getSource()).toBe(`${QUOTED_FENCE}>\n> x\n`);
	});

	// v1 refuses every input type but text: a paste has block structure the boundary has no
	// rule for yet, so it is declined rather than guessed at.
	test('a paste at the gap changes nothing and keeps the gap', async () => {
		await loadThenArrive(editor);
		await editor.seedClipboard('pasted\n');

		await editor.paste(`${primaryModifier}+v`);
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(TABLE_THEN_FENCE);
		expect(await editor.bridge.getGapCaret()).toEqual(AT_BOUNDARY);
	});
});

test.describe('undo and redo across a mint', () => {
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

	// The entry below the mint is an ordinary text edit, so the second undo proves the gap
	// entry did not swallow the stack beneath it.
	test('a second undo carries on past the mint', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.focusBlockStart(0);
		await editor.typeSlowly('EDIT');
		await editor.bridge.waitForSourceContains('EDITpara');
		await editor.waitForUndoBatchFlush();
		await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
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

// The unit harness cannot see a windowing flush, so a document long enough to window is the
// only oracle for the restore's reveal.
test.describe('undo onto a windowed-out boundary', () => {
	const AT_MID = { parentPath: [], index: 101 };

	test('the restore reveals the boundary and parks the caret there', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(WINDOWED);
		expect(await editor.bridge.getBlockKind(100)).toBe('table');

		await page.evaluate(() => (window as any).__test.rects.scrollTo([100]));
		await page.locator('[role="cell"]').nth(LAST_CELL).click();
		await page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_MID);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('\nx\n');

		// Scroll the boundary out of the window, so the restore has something to reveal.
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
		await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.undo();

		await editor.bridge.waitForSourceEquals(TABLE_THEN_FENCE);
	});
});
