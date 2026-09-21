import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { editorScrollHeight, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Windowing when the app scales the text. The estimated heights decide how tall the spacers
// are and, through the activation threshold, whether a document windows at all, so they have to
// follow `--editor-font-size`; otherwise a document just under the threshold at the default
// size is mounted whole at 2rem.

// Sized to sit either side of the activation threshold: under it at the default size, over it
// at 2rem. The rendered height at 2rem is checked below, so this is a real crossing rather than
// a miscount the scaling introduced.
const NEAR_WATERMARK_BLOCKS = 80;
const NEAR_WATERMARK_DOC = `${Array.from(
	{ length: NEAR_WATERMARK_BLOCKS },
	(_, i) => `Short line ${i}.`
).join('\n\n')}\n`;

const setTypeScale = (page: Page, value: string) =>
	page.addStyleTag({ content: `.editor { --editor-font-size: ${value}; }` });

async function settleScale(editor: EditorPage): Promise<void> {
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();
}

/** Windowing turns off at a lower height than it turns on at, and the route's own document is
 *  over the threshold, so without loading a one-block document first the fixture meets the
 *  lower threshold instead. */
async function loadNearWatermark(editor: EditorPage): Promise<void> {
	await editor.loadContent('baseline\n');
	await editor.loadContent(NEAR_WATERMARK_DOC);
	await settleScale(editor);
}

test('a near-watermark document does not window at the default type scale', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await loadNearWatermark(editor);

	// The control for the case below: without it, "it windows at 2rem" could be true of a
	// fixture that would have windowed at any size.
	expect(await spacerCount(page)).toBe(0);
	expect(await editor.getDomBlockCount()).toBe(NEAR_WATERMARK_BLOCKS);
	expect(pageErrors).toEqual([]);
});

test('the same document windows at a 2rem type scale', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await setTypeScale(page, '2rem');
	await loadNearWatermark(editor);

	// Estimates taken at the default size report about 3200px against a 4000px threshold, so
	// every block mounts, which is the slow load windowing exists to prevent.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await editor.getDomBlockCount()).toBeLessThan(NEAR_WATERMARK_BLOCKS / 2);

	// Measured on the rendered height, which is what shows windowing is right to run here.
	// Reading the scrollable height would prove nothing: with windowing on, that is the estimate.
	const blockHeight = (await editor.getBlock(0).boundingBox())!.height;
	expect(blockHeight * NEAR_WATERMARK_BLOCKS).toBeGreaterThan(4000);
	expect(pageErrors).toEqual([]);
});

test('a live type-scale change re-estimates the off-window set', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	const blockCount = await editor.loadLargeFixture('many-small-blocks', 500_000);
	expect(blockCount).toBeGreaterThan(2000);

	const before = await editorScrollHeight(page);
	await setTypeScale(page, '2rem');
	await settleScale(editor);
	const after = await editorScrollHeight(page);

	// The few dozen mounted blocks correct themselves through their own resize either way;
	// without estimates that follow the text size the other thousands do not, and the total
	// height barely moves.
	console.log(`type-scale reflow ${JSON.stringify({ blockCount, before, after })}`);
	expect(after / before).toBeGreaterThan(1.4);
	expect(pageErrors).toEqual([]);
});
