import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * VR-12 reachability for the container-matching paste. `paste/container-match.ts`
 * lands the post-paste caret with
 * `focusByPath(outerState.innerBlockRefs, [spliceIndex + remainingItems.length, 0], …)`
 * — an index that scales with the CLIPBOARD's item count, not with where the caret
 * was. `focusByPath` is synchronous and does not reveal an off-window head, so once
 * the pasted run is longer than the container window's overscan (6), the target ref
 * is unmounted and the dispatcher returns silently: caret lost.
 *
 * Focus is asserted by TYPING, never by reading source: `getSource()` serializes the
 * CST and is identical whatever the caret did.
 */

// ~600 items clears container windowing's 4000px activation watermark.
const LONG_LIST =
	Array.from({ length: 600 }, (_, i) => `- item ${i} ${'word '.repeat(4).trim()}`).join('\n') +
	'\n';

// Well past overscan (6), so the landing index is far outside the mounted window.
const PASTED_ITEMS = 40;
const CLIPBOARD = Array.from({ length: PASTED_ITEMS }, (_, i) => `- pasted ${i}`).join('\n') + '\n';

test.describe('VR-12: container-matching paste focus under container windowing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the caret is lost after the paste (VR-12 inverted pin)', async ({ page }) => {
		await editor.loadContent(LONG_LIST);
		await editor.waitForRenderFlush();

		// Non-vacuity: without an active container window the landing ref is always
		// mounted and this test could not observe VR-12 at all.
		expect(
			await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length),
			'container windowing is not active — the fixture no longer clears the watermark'
		).toBeGreaterThan(0);

		await page.evaluate((text) => navigator.clipboard.writeText(text), CLIPBOARD);

		// Paste into an item near the top of the mounted window, so the landing index
		// (here + 40) is far below anything mounted.
		await editor.clickBlockAtPath([0, 2, 0], 'item 2'.length);
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('pasted 39');
		await editor.waitForRenderFlush();

		// The marker goes where the caret actually is. A lost caret leaves it in the
		// paste target, in <body> (nowhere in the source), or in the wrong item.
		await editor.typeSlowly('ZZ');
		await editor.waitForRenderFlush();

		// INVERTED PIN for a known defect (docs/issues.md § Virtual rendering). The
		// caret is lost today, so the marker reaches the document nowhere at all — that
		// is what this asserts, and it is wrong on purpose. `test.fail()` was rejected
		// here: it is satisfied by ANY failure, so a fixture that stopped clearing the
		// windowing watermark, or a paste that never landed, would have kept the file
		// green for the wrong reason. Everything above is a hard assertion instead, so
		// only the caret behaviour is inverted.
		//
		// WHEN THE FOCUS PATH IS FIXED this assertion fails. Replace it with:
		//   expect(source).toContain('- pasted 39ZZ');
		// and drop the ledger entry.
		const source = await editor.bridge.getSource();
		expect(
			source,
			'the caret now survives the paste — VR-12 is fixed; invert this assertion back (see the comment above) and remove the docs/issues.md entry'
		).not.toContain('ZZ');
	});
});
