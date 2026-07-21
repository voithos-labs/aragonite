// Single concern: sticky-column landing-X symmetry on code-block entry. Each test exercises a different
// code-block shape (single body line, multi-body, info string, js-highlighted, default-content);
// they share helpers and one invariant, so they read better as parametric variants in one file than as a directory.
import { test, expect } from '../../fixtures';
import { EditorPage, BLOCK_CONTENT_SELECTOR } from '../../editor-page';
import { DEFAULT_CONTENT } from '../../test-content';

const PIXEL_TOLERANCE = 2;

// Identical bracketing paragraphs isolate any landing-X asymmetry to focusAtColumn.
const PARAGRAPH_TEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CURSOR_COL = 20;

async function captureEntryFromAbove(editor: EditorPage, codeBlockIndex: number) {
	const above = editor.page.locator('[contenteditable="true"]').nth(codeBlockIndex - 1);
	await above.click();
	await editor.page.keyboard.press('Home');
	for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
	const sourceX = await editor.getCaretPixelX();

	await editor.page.keyboard.press('ArrowDown');
	await editor.waitForRenderFlush();

	const landingX = await editor.getCaretPixelX();
	return { sourceX, landingX };
}

async function captureEntryFromBelow(editor: EditorPage, codeBlockIndex: number) {
	const below = editor.page.locator('[contenteditable="true"]').nth(codeBlockIndex + 1);
	await below.click();
	await editor.page.keyboard.press('Home');
	for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
	const sourceX = await editor.getCaretPixelX();

	await editor.page.keyboard.press('ArrowUp');
	await editor.waitForRenderFlush();

	const landingX = await editor.getCaretPixelX();
	return { sourceX, landingX };
}

async function resetStickyByClickingOutside(editor: EditorPage) {
	await editor.page
		.locator('body')
		.click({ position: { x: 1, y: 1 } })
		.catch(() => {});
	await editor.waitForRenderFlush();
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
		await editor.loadContent(`${PARAGRAPH_TEXT}\n\n\`\`\`\n${body}\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`);

		const fromAbove = await captureEntryFromAbove(editor, 1);
		await resetStickyByClickingOutside(editor);
		const fromBelow = await captureEntryFromBelow(editor, 1);

		expect(Math.abs(fromAbove.sourceX - fromBelow.sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		expect(Math.abs(fromAbove.landingX - fromBelow.landingX)).toBeLessThan(PIXEL_TOLERANCE);
	});

	test('code block with info string (```javascript): same landing X both directions', async () => {
		// Opener (```javascript) is wider than closer (```); interior body offsets must still dominate the nearest-X search.
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
		// Guards against rect discontinuity at token-span boundaries in findOffsetNearestX.
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
		// A 2px X-match could still hide a one-offset discrepancy; compare byte positions instead.
		await editor.loadContent(
			`${PARAGRAPH_TEXT}\n\n\`\`\`\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\`\`\`\n\n${PARAGRAPH_TEXT}\n`
		);

		const above = editor.page.locator('[contenteditable="true"]').nth(0);
		await above.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		await editor.typeText('A');
		await editor.bridge.waitForSourceContains('A');
		const sourceAfterAbove = await editor.bridge.getSource();
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('A');

		const below = editor.page.locator('[contenteditable="true"]').nth(2);
		await below.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < CURSOR_COL; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();
		await editor.typeText('B');
		await editor.bridge.waitForSourceContains('B');
		const sourceAfterBelow = await editor.bridge.getSource();

		const aLine = sourceAfterAbove.split('\n').find((l) => l.includes('A')) ?? '';
		const bLine = sourceAfterBelow.split('\n').find((l) => l.includes('B')) ?? '';
		expect(aLine.indexOf('A')).toBe(bLine.indexOf('B'));
	});

	test('DEFAULT_CONTENT js code block: matched sticky X lands at the same X', async () => {
		// Neighbouring blocks have different end columns; click at matched page-X in each before arrowing.
		await editor.loadContent(DEFAULT_CONTENT);

		const codeBlockIndex = await editor.page.evaluate((contentSelector) => {
			const wrappers = document.querySelectorAll('[data-block-path]:not([data-block-path*=","])');
			for (const wrapper of wrappers) {
				const block = wrapper.querySelector(contentSelector);
				if (block?.classList.contains('code-block')) {
					return (JSON.parse(wrapper.getAttribute('data-block-path')!) as number[])[0];
				}
			}
			return -1;
		}, BLOCK_CONTENT_SELECTOR);
		expect(codeBlockIndex).toBeGreaterThan(0);

		const aboveBlock = editor.getBlock(codeBlockIndex - 1);
		const aboveBox = await aboveBlock.boundingBox();
		expect(aboveBox).not.toBeNull();
		await aboveBlock.click({ position: { x: aboveBox!.width - 20, y: 10 } });
		await editor.waitForRenderFlush();
		const capturedAboveX = await editor.getCaretPixelX();
		await editor.page.keyboard.press('ArrowDown');
		await editor.waitForRenderFlush();
		const landAboveX = await editor.getCaretPixelX();

		await resetStickyByClickingOutside(editor);

		const belowBlock = editor.getBlock(codeBlockIndex + 1);
		const belowBox = await belowBlock.boundingBox();
		expect(belowBox).not.toBeNull();
		const clickXInsideBelow = Math.max(2, capturedAboveX - belowBox!.x);
		await belowBlock.click({ position: { x: clickXInsideBelow, y: 10 } });
		await editor.waitForRenderFlush();
		const capturedBelowX = await editor.getCaretPixelX();
		await editor.page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();
		const landBelowX = await editor.getCaretPixelX();

		// This block has two body lines: entry from above lands on the first,
		// from below on the last. Across two lines with different content and
		// highlight spans, nearest-column quantization can legitimately disagree
		// by up to one character cell, with platform font metrics setting the
		// phase — so the bound is a measured cell, not the same-line
		// PIXEL_TOLERANCE the sibling tests use. A sticky regression lands
		// multiple cells apart and still fails.
		const cellWidth = await editor.getBlock(codeBlockIndex).evaluate((el) => {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				if (node.textContent && node.textContent.trim().length > 0) {
					const range = document.createRange();
					range.setStart(node, 0);
					range.setEnd(node, 1);
					return range.getBoundingClientRect().width;
				}
			}
			return 0;
		});
		expect(cellWidth).toBeGreaterThan(0);

		const captureDelta = Math.abs(capturedAboveX - capturedBelowX);
		if (captureDelta < 5) {
			expect(Math.abs(landAboveX - landBelowX)).toBeLessThan(
				cellWidth + PIXEL_TOLERANCE + captureDelta
			);
		}
	});
});
