/**
 * Sticky column — code block entry symmetry.
 *
 * Pins the invariant that a code block lands the cursor at the same pixel X
 * (and the same body offset) whether it is entered via ArrowDown from above
 * or ArrowUp from below, given the same captured sticky X in both cases.
 *
 * Investigated after a report that entry-from-below felt "a bit different"
 * from entry-from-above. No asymmetry reproduces; these tests guard against
 * a future regression in findOffsetNearestX / CodeBlock.focusAtColumn.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { DEFAULT_CONTENT } from '../test-content';

const PIXEL_TOLERANCE = 2;

// Identical paragraphs bracket a code block so that walking to the same
// column in either paragraph produces the same sticky X — any landing-X
// asymmetry inside the code block then isolates to focusAtColumn.
const PARAGRAPH_TEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CURSOR_COL = 20;

async function captureEntryFromAbove(editor: EditorPage, codeBlockIndex: number) {
	const above = editor.page.locator('[contenteditable="true"]').nth(codeBlockIndex - 1);
	await above.click();
	await editor.page.keyboard.press('Home');
	for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
	const sourceX = await editor.getCaretPixelX();

	await editor.pressArrowDown();
	await editor.page.waitForTimeout(120);

	const landingX = await editor.getCaretPixelX();
	return { sourceX, landingX };
}

async function captureEntryFromBelow(editor: EditorPage, codeBlockIndex: number) {
	const below = editor.page.locator('[contenteditable="true"]').nth(codeBlockIndex + 1);
	await below.click();
	await editor.page.keyboard.press('Home');
	for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
	const sourceX = await editor.getCaretPixelX();

	await editor.pressArrowUp();
	await editor.page.waitForTimeout(120);

	const landingX = await editor.getCaretPixelX();
	return { sourceX, landingX };
}

async function resetStickyByClickingOutside(editor: EditorPage) {
	await editor.page
		.locator('body')
		.click({ position: { x: 1, y: 1 } })
		.catch(() => {});
	await editor.page.waitForTimeout(50);
}

test.describe('sticky column: code block entry symmetry', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('single-body-line code block: same landing X both directions', async () => {
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const fromAbove = await captureEntryFromAbove(editor, 1);
		await resetStickyByClickingOutside(editor);
		const fromBelow = await captureEntryFromBelow(editor, 1);

		expect(Math.abs(fromAbove.sourceX - fromBelow.sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		expect(Math.abs(fromAbove.landingX - fromBelow.landingX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('multi-body-line code block: same landing X both directions', async () => {
		const body = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ncccccccccccccc\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`\n${body}\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const fromAbove = await captureEntryFromAbove(editor, 1);
		await resetStickyByClickingOutside(editor);
		const fromBelow = await captureEntryFromBelow(editor, 1);

		expect(Math.abs(fromAbove.sourceX - fromBelow.sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		expect(Math.abs(fromAbove.landingX - fromBelow.landingX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('code block with info string (```javascript): same landing X both directions', async () => {
		// The opener visual line is wider than the closer (```javascript vs ```),
		// so the first and last visual lines are not symmetric in width. The
		// landing must still match because interior body offsets dominate the
		// nearest-X search when sticky is on the body line.
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`javascript\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const fromAbove = await captureEntryFromAbove(editor, 1);
		await resetStickyByClickingOutside(editor);
		const fromBelow = await captureEntryFromBelow(editor, 1);

		expect(Math.abs(fromAbove.sourceX - fromBelow.sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		expect(Math.abs(fromAbove.landingX - fromBelow.landingX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('js-highlighted body (token spans split the line): same landing X both directions', async () => {
		// highlight.js fragments the body into many adjacent token spans.
		// findOffsetNearestX walks across span boundaries; any rect discontinuity
		// at a boundary would produce direction-dependent landings.
		const body = 'const xxxxxxxxxx = 1234567890 + 9876543210;';
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`js\n${body}\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const fromAbove = await captureEntryFromAbove(editor, 1);
		await resetStickyByClickingOutside(editor);
		const fromBelow = await captureEntryFromBelow(editor, 1);

		expect(Math.abs(fromAbove.sourceX - fromBelow.sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		expect(Math.abs(fromAbove.landingX - fromBelow.landingX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('landing body offset (not just X) matches from both directions', async () => {
		// A pixel-X match within 2px could still hide a one-offset discrepancy.
		// Type a marker character after each entry and compare byte positions in
		// the serialized body line.
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const above = editor.page.locator('[contenteditable="true"]').nth(0);
		await above.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(120);
		await editor.typeText('A');
		await editor.page.waitForTimeout(120);
		const sourceAfterAbove = await editor.getSource();
		await editor.undo();
		await editor.page.waitForTimeout(120);

		const below = editor.page.locator('[contenteditable="true"]').nth(2);
		await below.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(120);
		await editor.typeText('B');
		await editor.page.waitForTimeout(120);
		const sourceAfterBelow = await editor.getSource();

		const aLine = sourceAfterAbove.split('\n').find((l) => l.includes('A')) ?? '';
		const bLine = sourceAfterBelow.split('\n').find((l) => l.includes('B')) ?? '';
		expect(aLine.indexOf('A')).toBe(bLine.indexOf('B'));
	});

	test('DEFAULT_CONTENT js code block: matched sticky X lands at the same X', async () => {
		// Uses the real document from the /test/editor harness. Because the
		// block above the code block (a list item) and the block below ("A final
		// paragraph.") have different end columns, we cannot just press End in
		// both; we click at matched page-X positions in each neighbour before
		// pressing the arrow key, producing equivalent sticky captures.
		await editor.loadContent(DEFAULT_CONTENT);

		const codeBlockIndex = await editor.page.evaluate(() => {
			const blocks = document.querySelectorAll(
				'.block-list > .block-host > :not(.selection-overlay)'
			);
			for (let i = 0; i < blocks.length; i++) {
				if (blocks[i].classList.contains('code-block')) return i;
			}
			return -1;
		});
		expect(codeBlockIndex).toBeGreaterThan(0);

		// ── From above ─────────────────────────────────────────
		const aboveBlock = editor.getBlock(codeBlockIndex - 1);
		const aboveBox = await aboveBlock.boundingBox();
		expect(aboveBox).not.toBeNull();
		await aboveBlock.click({ position: { x: aboveBox!.width - 20, y: 10 } });
		await editor.page.waitForTimeout(50);
		const capturedAboveX = await editor.getCaretPixelX();
		await editor.pressArrowDown();
		await editor.page.waitForTimeout(150);
		const landAboveX = await editor.getCaretPixelX();

		await resetStickyByClickingOutside(editor);

		// ── From below ─────────────────────────────────────────
		const belowBlock = editor.getBlock(codeBlockIndex + 1);
		const belowBox = await belowBlock.boundingBox();
		expect(belowBox).not.toBeNull();
		const clickXInsideBelow = Math.max(2, capturedAboveX - belowBox!.x);
		await belowBlock.click({ position: { x: clickXInsideBelow, y: 10 } });
		await editor.page.waitForTimeout(50);
		const capturedBelowX = await editor.getCaretPixelX();
		await editor.pressArrowUp();
		await editor.page.waitForTimeout(150);
		const landBelowX = await editor.getCaretPixelX();

		// Only assert landing symmetry when the two clicks produced matched
		// sticky Xs — otherwise we'd be comparing different starting columns.
		if (Math.abs(capturedAboveX - capturedBelowX) < 5) {
			expect(Math.abs(landAboveX - landBelowX)).toBeLessThan(PIXEL_TOLERANCE);
		}
	});
});
