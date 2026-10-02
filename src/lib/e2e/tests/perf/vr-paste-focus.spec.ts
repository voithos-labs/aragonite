import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { spacerCount } from './vr-helpers';

/**
 * Where the caret lands after a structural paste (VR-12): at the end of the pasted run, an index
 * that grows with the clipboard, so a long run lands it past the mounted window, where an
 * immediate lookup cannot mount it. Focus is checked by typing, since `getSource()` reads the same
 * whatever the caret did.
 */

// About 600 items puts the container past the 4000px at which windowing starts.
const LONG_LIST =
	Array.from({ length: 600 }, (_, i) => `- item ${i} ${'word '.repeat(4).trim()}`).join('\n') +
	'\n';

// Well past the six extra items kept mounted, so the landing is far outside the window.
const PASTED_ITEMS = 40;
const CLIPBOARD = Array.from({ length: PASTED_ITEMS }, (_, i) => `- pasted ${i}`).join('\n') + '\n';

// The paste splits the target at the caret into the text before it, the pasted items and the
// text after, so the caret belongs on the last pasted item, never on the text after it.
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

		// Without windowing inside the container the target is always mounted and the test proves
		// nothing.
		expect(
			await spacerCount(page, '.list-block >'),
			'container windowing is not active: the fixture no longer clears the watermark'
		).toBeGreaterThan(0);

		await editor.seedClipboard(CLIPBOARD);

		// Paste into an item near the top of the mounted window, so the landing, 40 items
		// further on, is far below anything mounted.
		await editor.clickBlockAtPath([0, TARGET_ITEM, 0], 'item 2'.length);
		await editor.paste();
		await editor.bridge.waitForSourceContains(LAST_PASTED_TEXT);

		// The source is final at the commit, before the landing item has mounted, so waiting
		// on the bytes would type into whatever still had focus.
		await expect
			.poll(() => cursorOffsetAt(page, [0, LANDING_ITEM, 0]), {
				message: 'the caret never reached the last pasted item (VR-12)'
			})
			.not.toBeNull();

		await editor.typeSlowly('ZZ');
		await editor.waitForRenderFlush();

		// The marker goes wherever the caret really is. A lost caret leaves it in the block
		// pasted into, on <body>, where it reaches the source at all, or in the wrong item.
		expect(await editor.bridge.getSource()).toContain(`- ${LAST_PASTED_TEXT}ZZ`);
	});
});
