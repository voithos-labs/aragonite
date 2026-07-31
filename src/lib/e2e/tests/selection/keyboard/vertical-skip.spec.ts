import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { topLevelHostPresent } from '../../../page-probes';

const TRANSPARENT_MIDDLE = 'first\n\n![pic](/test-fixtures/sample.png)\n\nthird\n';
const LIST_ONLY_TRANSPARENT =
	'above\n\n- ![pic](/test-fixtures/sample.png)\n- ![pic](/test-fixtures/sample.png)\n\nbelow\n';

// Tall enough to window, so at the top scroll position the tail is UNMOUNTED and the
// transparency decision for the final block cannot come from a component — it must read
// the CST.
const WINDOWED_TAIL_BLOCKS = 800;
function windowedDocWithTransparentTail(): string {
	const text = Array.from({ length: WINDOWED_TAIL_BLOCKS }, (_, i) => `para ${i}`).join('\n\n');
	return `${text}\n\n![pic](/test-fixtures/sample.png)\n`;
}

test.describe('selection — keyboard: vertical-skip parity (G1)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+ArrowDown from collapsed caret skips a transparent middle paragraph', async () => {
		await editor.loadContent(TRANSPARENT_MIDDLE);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([2]);
		expect(sel!.focus.offset).toBe(0);
	});

	test('Shift+ArrowUp from collapsed caret skips a transparent middle paragraph', async () => {
		await editor.loadContent(TRANSPARENT_MIDDLE);
		await editor.focusBlockStart(2);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([2]);
		expect(sel!.focus.path).toEqual([0]);
	});

	test('continued Shift+ArrowDown while cross-block active passes over a transparent paragraph', async () => {
		// Four-block fixture so the second Shift+ArrowDown has somewhere to land
		// past the transparent paragraph.
		await editor.loadContent('first\n\nsecond\n\n![pic](/test-fixtures/sample.png)\n\nfourth\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		// Cross-block is now active, focus on [1] (the second text paragraph).
		await editor.page.keyboard.press('Shift+ArrowDown');
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([3]);
	});

	test('continued Shift+ArrowUp while cross-block active passes over a transparent paragraph', async () => {
		await editor.loadContent('first\n\n![pic](/test-fixtures/sample.png)\n\nthird\n\nfourth\n');
		await editor.focusBlockStart(3);
		await editor.page.keyboard.press('Shift+ArrowUp');
		await editor.waitForCrossBlock(true);
		// Cross-block is now active, focus on [2] (the "third" paragraph).
		await editor.page.keyboard.press('Shift+ArrowUp');
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([0]);
	});

	test('Shift+ArrowDown skips a list whose every item is image-only', async () => {
		await editor.loadContent(LIST_ONLY_TRANSPARENT);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		// The list (children[1]) contains two image-only items; container
		// recursion makes the whole list transparent. Focus should bypass it
		// and land on the "below" paragraph at [2].
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path[0]).toBe(2);
	});

	test('Ctrl+Shift+End from first block lands on the last text-bearing block when the last is transparent', async () => {
		await editor.loadContent('start\n\nmid\n\n![pic](/test-fixtures/sample.png)\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Ctrl+Shift+Home from last block lands on the first text-bearing block when the first is transparent', async () => {
		await editor.loadContent('![pic](/test-fixtures/sample.png)\n\nmid\n\nend\n');
		await editor.focusBlockEnd(2);
		await editor.page.keyboard.press('Control+Shift+Home');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([1]);
	});

	test('Ctrl+Shift+End skips an OFF-window transparent last block in a windowed doc (VR-6)', async ({
		page
	}) => {
		await editor.loadContent(windowedDocWithTransparentTail());
		const lastIdx = WINDOWED_TAIL_BLOCKS; // the image-only paragraph
		const lastTextIdx = WINDOWED_TAIL_BLOCKS - 1;

		// If the last block were mounted, a component-gated transparency check would pass too and
		// the test would be vacuous.
		await editor.focusBlockStart(0);
		expect(await topLevelHostPresent(page, lastIdx)).toBe(false);
		expect(await topLevelHostPresent(page, lastTextIdx)).toBe(false);

		await page.keyboard.press('Control+Shift+End');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		// Matches the non-windowed result. A component-gated check returns null for the off-window
		// image, so it is not skipped and focus lands on the image block instead.
		expect(sel!.focus.path).toEqual([lastTextIdx]);
	});

	test('Shift+ArrowRight does not skip a transparent next paragraph (horizontal vs vertical)', async () => {
		// Horizontal extension must NOT apply vertical-skip — Shift+ArrowRight
		// across a boundary into an image-only paragraph should land focus on
		// that paragraph, not skip it. This guards against an over-eager fix.
		await editor.loadContent(TRANSPARENT_MIDDLE);
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.waitForCrossBlock(true);
		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.focus.path).toEqual([1]);
	});
});
