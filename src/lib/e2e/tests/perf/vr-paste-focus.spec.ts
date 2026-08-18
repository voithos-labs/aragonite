import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * VR-12 for the structural paste landing. The caret lands at the end of the pasted run — an
 * index that scales with the CLIPBOARD's item count, not with where the caret was — so once
 * the run clears the container window's overscan the target is unmounted and a sync ref
 * lookup cannot mount it. Focus is asserted by TYPING, never by reading source: `getSource()`
 * serializes the CST and reads identically whatever the caret did.
 */

// ~600 items clears container windowing's 4000px activation watermark.
const LONG_LIST =
	Array.from({ length: 600 }, (_, i) => `- item ${i} ${'word '.repeat(4).trim()}`).join('\n') +
	'\n';

// Well past overscan (6), so the landing index is far outside the mounted window.
const PASTED_ITEMS = 40;
const CLIPBOARD = Array.from({ length: PASTED_ITEMS }, (_, i) => `- pasted ${i}`).join('\n') + '\n';

// The paste splits the target at the caret into [prefix, ...pasted, residue], so the caret
// belongs on the last PASTED item — never the residue.
const TARGET_ITEM = 2;
const LANDING_ITEM = TARGET_ITEM + PASTED_ITEMS;
const LAST_PASTED_TEXT = `pasted ${PASTED_ITEMS - 1}`;

function cursorOffsetAt(page: EditorPage['page'], path: number[]): Promise<number | null> {
	return page.evaluate(
		(p) =>
			(
				window as unknown as {
					__test: { getBlockCursorSurface(path: number[]): { cursorOffset: number | null } };
				}
			).__test.getBlockCursorSurface(p).cursorOffset,
		path
	);
}

test.describe('VR-12: structural paste focus under container windowing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the caret lands in the last pasted item and typing continues there', async ({ page }) => {
		await editor.loadContent(LONG_LIST);
		await editor.waitForRenderFlush();

		// Non-vacuity: without an active container window the landing ref is always
		// mounted and this test could not observe VR-12 at all.
		expect(
			await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length),
			'container windowing is not active — the fixture no longer clears the watermark'
		).toBeGreaterThan(0);

		await editor.seedClipboard(CLIPBOARD);

		// Paste into an item near the top of the mounted window, so the landing index
		// (here + 40) is far below anything mounted.
		await editor.clickBlockAtPath([0, TARGET_ITEM, 0], 'item 2'.length);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains(LAST_PASTED_TEXT);

		// The source is final at commit time, before the reveal has mounted the landing
		// item, so waiting on bytes would type into whatever still held focus.
		await expect
			.poll(() => cursorOffsetAt(page, [0, LANDING_ITEM, 0]), {
				message: 'the caret never reached the last pasted item — VR-12'
			})
			.not.toBeNull();

		await editor.typeSlowly('ZZ');
		await editor.waitForRenderFlush();

		// The marker goes where the caret actually is. A lost caret leaves it in the
		// paste target, in <body> (nowhere in the source), or in the wrong item.
		expect(await editor.bridge.getSource()).toContain(`- ${LAST_PASTED_TEXT}ZZ`);
	});
});
