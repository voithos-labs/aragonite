import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { editorScrollHeight, spacerCount } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Windowing under a host type scale. The height oracle's estimates decide the
// spacer geometry AND — through the activation watermark — whether a document
// windows at all, so they have to track `--editor-font-size`: at 2rem every line
// box doubles and the characters per line halve. A document just under the
// watermark at the default scale is over it at 2rem, and an oracle calibrated for
// one scale mounts the whole thing instead.

// Sized to straddle the 4000px activation watermark: ~40px estimated per block at
// the default scale (3200px, under it) against ~64px at 2rem (5120px, over it),
// with the rendered height at 2rem clearing it too — asserted below, so the case
// is a real crossing rather than an over-count the scaling introduced.
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

/** The route mounts the showcase, which is over the watermark, and windowing is
 *  hysteretic — so load a one-block document first. Without it the fixture below
 *  faces the LOW watermark (a deactivation decision) and the crossing under test
 *  never happens. */
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

	// The control for the case below: this document is genuinely small at the
	// default scale, so "it windows at 2rem" is about the scale, not about a
	// fixture that would have windowed either way — and a scale-aware oracle must
	// not over-window it here.
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

	// Warrant, measured rather than assumed: the RENDERED height at this scale
	// clears the watermark, so windowing here is correct. Reading the scrollable
	// height instead would be circular — with windowing on it IS the estimate the
	// gate just used.
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

	// Mounted blocks heal through their own resize path either way, but they are a
	// couple of dozen out of thousands — without a scale-aware estimate the document
	// height barely moves (~1.00x) while every line on screen doubles.
	console.log(`type-scale reflow ${JSON.stringify({ blockCount, before, after })}`);
	expect(after / before).toBeGreaterThan(1.4);
	expect(pageErrors).toEqual([]);
});
