import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { textRunRect } from '../../text-runs';

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

/** An endpoint block's painted rects in its own box's pixels, with the box's size. */
async function endpointPaint(
	page: Page,
	path: number[]
): Promise<{ rects: Box[]; width: number; height: number }> {
	return page.evaluate((key) => {
		const host = document.querySelector(`[data-block-path='${key}']`);
		if (!host) throw new Error(`no block at ${key}`);
		const box = host.getBoundingClientRect();
		const rects = [...host.querySelectorAll(':scope > .selection-overlay-endpoint')].map((el) => {
			const r = el.getBoundingClientRect();
			return {
				left: r.left - box.left,
				top: r.top - box.top,
				right: r.right - box.left,
				bottom: r.bottom - box.top
			};
		});
		rects.sort((a, b) => a.top - b.top);
		return { rects, width: box.width, height: box.height };
	}, JSON.stringify(path));
}

test.describe('selection: overlay: mid-text ends reach the line edges', () => {
	// [0] a heading, [1] a paragraph, [2] a list, [3] a quote of two lines, [4] a code block.
	const KINDS = [
		'## Heading with some words',
		'',
		'A paragraph with a few words in it',
		'',
		'- first item',
		'- second item',
		'',
		'> quote line one',
		'>',
		'> quote line two',
		'',
		'```js',
		'const a = 1;',
		'const b = 2;',
		'```',
		''
	].join('\n');

	const RANGES: [string, number[], number, number[], number][] = [
		['a heading to a paragraph', [0], 6, [1], 12],
		['a paragraph to a list item', [1], 12, [2, 1, 0], 4],
		['a list item to a quote line', [2, 0, 0], 3, [3, 1], 6],
		['a quote line to a code block', [3, 0], 6, [4], 12]
	];

	for (const mode of ['source', 'live']) {
		for (const [name, startPath, startOffset, endPath, endOffset] of RANGES) {
			test(`${mode}: ${name}`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(KINDS);
				await editor.focusBlockAtPath(startPath, startOffset);
				await editor.shiftClickBlock(endPath, endOffset);
				await editor.waitForCrossBlock(true);

				// The start runs from its point, mid-line, to the right edge, and every line below it.
				const start = await endpointPaint(page, startPath);
				expect(start.rects.length).toBeGreaterThan(0);
				expect(start.rects[0].left).toBeGreaterThan(1);
				for (const rect of start.rects) expect(rect.right).toBeGreaterThanOrEqual(start.width - 1);
				expect(start.rects.at(-1)!.bottom).toBeGreaterThanOrEqual(start.height - 1);

				// The end takes every line above it, then runs from the left edge to its point.
				const end = await endpointPaint(page, endPath);
				expect(end.rects.length).toBeGreaterThan(0);
				const last = end.rects.at(-1)!;
				expect(last.left).toBeLessThanOrEqual(1);
				expect(last.right).toBeLessThan(end.width - 1);
				expect(end.rects[0].top).toBeLessThanOrEqual(1);

				expect(doubledPaint(await paintedRects(page))).toEqual([]);
			});
		}
	}
});

/** The glyph box of each line the block at `path` paints, in its own box's pixels. */
async function glyphLines(page: Page, path: number[]): Promise<Box[]> {
	return page.evaluate((key) => {
		const host = document.querySelector(`[data-block-path='${key}']`);
		if (!host) throw new Error(`no block at ${key}`);
		const box = host.getBoundingClientRect();
		const rects: DOMRect[] = [];
		for (const el of [host, ...host.querySelectorAll('*')]) {
			for (const node of el.childNodes) {
				if (node.nodeType !== Node.TEXT_NODE) continue;
				const range = document.createRange();
				range.selectNodeContents(node);
				rects.push(...range.getClientRects());
			}
		}
		const lines: { left: number; top: number; right: number; bottom: number }[] = [];
		for (const r of rects) {
			if (r.width < 0.5 || r.height < 0.5) continue;
			const top = r.top - box.top;
			const bottom = r.bottom - box.top;
			const line = lines.find((l) => top < l.bottom && bottom > l.top);
			if (line) {
				line.top = Math.min(line.top, top);
				line.bottom = Math.max(line.bottom, bottom);
			} else lines.push({ left: r.left - box.left, top, right: r.right - box.left, bottom });
		}
		return lines.sort((a, b) => a.top - b.top);
	}, JSON.stringify(path));
}

test.describe('selection: overlay: an end paints its whole line, not its glyphs', () => {
	// [0] a quote whose line [0,0] is its only one, [1] the empty paragraph two blank lines leave,
	// [2] a numbered list.
	const QUOTE = [
		"> In the name of the Moon, I'll punish you!",
		'',
		'',
		'1. Fighting evil by moonlight,',
		'2. winning love by daylight,',
		'3. never running from a real fight,',
		'4. she is the one named Sailor Moon!',
		''
	].join('\n');

	const WRAPPED = [
		'A paragraph long enough to wrap onto a second line and then a third one in a narrow window, which is what this one does.',
		'',
		'A second paragraph that also wraps onto more than one line in a narrow window, as it has a lot of words.',
		''
	].join('\n');

	for (const mode of ['source', 'live']) {
		test(`${mode}: a one-line end paints from its point to the line's edge, the line's full height`, async ({
			page
		}) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.setPresentationMode(mode);
			await editor.loadContent(QUOTE);
			await editor.focusBlockAtPath([0, 0], 15);
			await editor.shiftClickBlock([2, 3, 0], 18);
			await editor.waitForCrossBlock(true);
			expect(await editor.bridge.getSelectionPaths()).toEqual({
				anchor: { path: [0, 0], offset: 15 },
				focus: { path: [2, 3, 0], offset: 18 }
			});

			// Nothing paints under "In the name of", and the paint from "the Moon" spans the line.
			const start = await endpointPaint(page, [0, 0]);
			const [startLine] = await glyphLines(page, [0, 0]);
			const startX = (await textRunRect(page, 'the Moon', { path: [0, 0] })).left;
			const startBox = (await page.locator("[data-block-path='[0,0]']").boundingBox())!;
			for (const rect of start.rects)
				expect(rect.left).toBeGreaterThanOrEqual(startX - startBox.x - 1);
			expect(start.rects[0].top).toBeLessThan(startLine.top - 1);
			expect(start.rects.at(-1)!.bottom).toBeGreaterThan(startLine.bottom + 1);

			// Nothing paints over "ed Sailor Moon!", and the paint up to "nam" spans the line.
			const end = await endpointPaint(page, [2, 3, 0]);
			const [endLine] = await glyphLines(page, [2, 3, 0]);
			const endX = (await textRunRect(page, 'ed Sailor', { path: [2, 3, 0] })).left;
			const endBox = (await page.locator("[data-block-path='[2,3,0]']").boundingBox())!;
			for (const rect of end.rects) expect(rect.right).toBeLessThanOrEqual(endX - endBox.x + 1);
			expect(end.rects[0].top).toBeLessThan(endLine.top - 1);
			expect(end.rects.at(-1)!.bottom).toBeGreaterThan(endLine.bottom + 1);

			expect(doubledPaint(await paintedRects(page))).toEqual([]);
		});

		test(`${mode}: the lines beside a wrapped end's line begin past its leading`, async ({
			page
		}) => {
			await page.setViewportSize({ width: 760, height: 1000 });
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.setPresentationMode(mode);
			await editor.loadContent(WRAPPED);
			const endOffset = WRAPPED.split('\n')[2].length - 5;
			await editor.focusBlockAtPath([0], 10);
			await editor.shiftClickBlock([1], endOffset);
			await editor.waitForCrossBlock(true);

			// The strip under the start's first line begins below that line's own leading.
			const startLines = await glyphLines(page, [0]);
			expect(startLines.length).toBeGreaterThan(1);
			const start = await endpointPaint(page, [0]);
			const below = start.rects.at(-1)!;
			expect(below.top).toBeGreaterThan(startLines[0].bottom + 1);
			expect(below.top).toBeLessThanOrEqual(startLines[1].top);

			// The strip over the end's last line stops above that line's own leading.
			const endLines = await glyphLines(page, [1]);
			expect(endLines.length).toBeGreaterThan(1);
			const end = await endpointPaint(page, [1]);
			const above = end.rects[0];
			expect(above.bottom).toBeLessThan(endLines.at(-1)!.top - 1);
			expect(above.bottom).toBeGreaterThanOrEqual(endLines.at(-2)!.bottom);

			expect(doubledPaint(await paintedRects(page))).toEqual([]);
		});
	}
});
