import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';

test.describe('selection: overlay: happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('middle block overlay renders for strictly-between blocks', async () => {
		await editor.loadContent('aaa\n\nbbb\n\nccc\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);
		await expect(
			editor.page.locator("[data-block-path='[1]'] .selection-overlay-middle").first()
		).toBeAttached();
	});

	test('single-block selection has no custom overlay divs', async () => {
		await editor.loadContent('one block here\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.waitForCrossBlock(false);
		await expect(editor.page.locator('.selection-overlay')).toHaveCount(0);
	});

	test('overlay disappears when selection collapses', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await expect(editor.page.locator('.selection-overlay').first()).toBeAttached();

		await editor.page.keyboard.press('ArrowLeft');
		await editor.waitForCrossBlock(false);

		await expect(editor.page.locator('.selection-overlay')).toHaveCount(0);
	});
});

test.describe('selection: overlay: edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('overlay has pointer-events: none', async () => {
		await editor.loadContent('aaa\n\nbbb\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		const pointerEvents = await editor.page.evaluate(() => {
			const el = document.querySelector('.selection-overlay');
			if (!el) return null;
			return getComputedStyle(el).pointerEvents;
		});
		expect(pointerEvents).toBe('none');
	});

	test('endpoint overlays appear on start and end blocks during drag', async () => {
		await editor.loadContent('aaa bbb\n\nccc\n\nddd eee\n');
		await editor.dragFromTo([0], 1, [2], 2);
		await expect(
			editor.page.locator("[data-block-path='[0]'] .selection-overlay-endpoint").first()
		).toBeAttached();
		await expect(
			editor.page.locator("[data-block-path='[2]'] .selection-overlay-endpoint").first()
		).toBeAttached();
	});

	test('a list item the range holds whole paints its own box', async () => {
		await editor.loadContent('- one\n- two\n- three\n- four\n');
		await editor.dragFromTo([0, 0, 0], 1, [0, 3, 0], 2);
		await editor.waitForCrossBlock(true);

		await expect(editor.page.locator('.list-item-block > .selection-overlay-middle')).toHaveCount(
			2
		);
	});

	test('a nested sub-list under a held item paints no second box', async () => {
		await editor.loadContent('- one\n- two\n  - sub\n- three\n- four\n');
		await editor.dragFromTo([0, 0, 0], 1, [0, 3, 0], 2);
		await editor.waitForCrossBlock(true);

		await expect(editor.page.locator('.list-item-block > .selection-overlay-middle')).toHaveCount(
			2
		);
		await expect(editor.page.locator("[data-block-path='[0,1,1]'] .selection-overlay")).toHaveCount(
			0
		);
	});

	test('a drag into a closed title row paints the details as one box, the row end to end', async ({
		page
	}) => {
		const plugins = new PluginsPage(page);
		await plugins.gotoPlugins('details');
		await plugins.loadContent(
			'Above\n\n<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n'
		);
		await plugins.dragFromTo([0], 2, [1, 0], 2);
		await plugins.waitForCrossBlock(true);

		const box = page.locator("[data-block-path='[1]'] > .selection-overlay-middle");
		await expect(box).toHaveCount(1);
		await expect(page.locator("[data-block-path='[1,0]'] .selection-overlay")).toHaveCount(0);
		const painted = (await box.boundingBox())!;
		const row = (await page.locator("[data-block-path='[1,0]']").boundingBox())!;
		expect(painted.x).toBeLessThanOrEqual(row.x);
		expect(painted.x + painted.width).toBeGreaterThanOrEqual(row.x + row.width);
	});

	test('a container the range holds whole paints one box, its children none', async () => {
		await editor.loadContent('before\n\n> quote line 1\n> quote line 2\n\nafter\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await expect(
			editor.page.locator("[data-block-path='[1]'] > .selection-overlay-middle")
		).toHaveCount(1);
		await expect(
			editor.page.locator("[data-block-path='[1]'] [data-block-path] .selection-overlay")
		).toHaveCount(0);
	});
});

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Every painted selection rect on the page, in viewport pixels. */
async function paintedRects(page: Page): Promise<Box[]> {
	return page.locator('.selection-overlay').evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		})
	);
}

/** Pairs of painted rects that share pixels, where the wash would show twice as dark. */
function doubledPaint(rects: Box[]): [Box, Box][] {
	const pairs: [Box, Box][] = [];
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
			const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
			if (w > 0.5 && h > 0.5) pairs.push([a, b]);
		}
	}
	return pairs;
}

test.describe('selection: overlay: one paint per block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// [1] a paragraph, [2] a list of four items.
	const PROBE = 'intro\n\nAgreed work\n- alpha\n- beta\n- gamma\n- delta\n\nLoose ends\n';

	test('a range from a block’s start to a block’s end boxes both ends, nothing twice', async ({
		page
	}) => {
		await editor.loadContent(PROBE);
		await editor.focusBlockStart(1);
		await editor.shiftClickBlock([2, 3, 0], 5);
		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.getSelectionPaths()).toEqual({
			anchor: { path: [1], offset: 0 },
			focus: { path: [2, 3, 0], offset: 5 }
		});

		await expect(page.locator("[data-block-path='[1]'] > .selection-overlay-middle")).toHaveCount(
			1
		);
		await expect(page.locator("[data-block-path='[2]'] > .selection-overlay-middle")).toHaveCount(
			1
		);
		await expect(page.locator("[data-block-path='[2]'] .selection-overlay")).toHaveCount(1);
		expect(doubledPaint(await paintedRects(page))).toEqual([]);
	});
});
