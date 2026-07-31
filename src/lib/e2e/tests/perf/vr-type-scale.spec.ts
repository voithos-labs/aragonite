import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { editorScrollHeight, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Windowing under a host type scale. The height oracle's estimates decide spacer geometry
// AND, through the activation watermark, whether a document windows at all — so they must
// track `--editor-font-size`, or a document just under the watermark at the default scale
// gets mounted whole at 2rem.

// Sized to straddle the activation watermark: under it at the default scale, over it at
// 2rem. The rendered height at 2rem is asserted below, so the case is a real crossing
// rather than an over-count the scaling introduced.
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

/** Windowing is hysteretic and the route's showcase is over the watermark, so without a
 *  one-block document first the fixture faces the LOW (deactivation) watermark instead. */
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

	// The control for the case below: without this, "it windows at 2rem" could be about a
	// fixture that would have windowed either way.
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

	// Estimates read at the default scale report ~3200px against a 4000px
	// threshold, so every block mounts — the load spike windowing exists to prevent.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await editor.getDomBlockCount()).toBeLessThan(NEAR_WATERMARK_BLOCKS / 2);

	// Measured on the RENDERED height, which warrants that windowing here is correct.
	// Reading scrollable height would be circular — with windowing on, it IS the estimate.
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

	// The mounted couple of dozen heal through their own resize path either way; without a
	// scale-aware estimate the other thousands do not, and total height barely moves.
	console.log(`type-scale reflow ${JSON.stringify({ blockCount, before, after })}`);
	expect(after / before).toBeGreaterThan(1.4);
	expect(pageErrors).toEqual([]);
});
