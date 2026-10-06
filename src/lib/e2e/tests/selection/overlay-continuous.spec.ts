import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { holes, paintedBands, paintedRegion, unpaintedMiddle, type Band } from './painted-region';

// A range across blocks paints one region, the way a code editor does: no hole between its first
// line and its last, and nothing above the first or below the last.
// Requirements: e2e/requirements/selection/overlay-continuous.md.

async function hostBox(page: Page, path: number[]): Promise<Band> {
	const box = (await page.locator(`[data-block-path='${JSON.stringify(path)}']`).boundingBox())!;
	return { top: box.y, bottom: box.y + box.height };
}

// A one-line quote, the empty paragraph two blank lines leave, then a numbered list.
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

const QUOTE_TO_PARAGRAPH = '> quote line one\n> quote line two\n\nA paragraph after the quote\n';

const CODE = '## Heading with some words\n\n```js\nconst a = 1;\nconst b = 2;\n```\n';

/** [name, document, anchor path, anchor offset, focus path, focus offset] */
const RANGES: [string, string, number[], number, number[], number][] = [
	['a quote line, over blank lines, into a list item', QUOTE, [0, 0], 15, [2, 3, 0], 18],
	['a quote into a paragraph', QUOTE_TO_PARAGRAPH, [0, 0], 6, [1], 5],
	['a heading into a padded code block', CODE, [0], 6, [1], 12]
];

for (const mode of ['source', 'live']) {
	test.describe(`selection: overlay: one continuous region (${mode})`, () => {
		for (const [name, doc, anchorPath, anchorOffset, focusPath, focusOffset] of RANGES) {
			test(name, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(doc);
				await editor.focusBlockAtPath(anchorPath, anchorOffset);
				await editor.shiftClickBlock(focusPath, focusOffset);
				await editor.waitForCrossBlock(true);

				const bands = await paintedBands(page);
				expect(bands.length).toBeGreaterThan(1);
				expect(holes(bands)).toEqual([]);

				// Nothing paints above the start block or below the end block.
				const start = await hostBox(page, anchorPath);
				const end = await hostBox(page, focusPath);
				expect(Math.min(...bands.map((b) => b.top))).toBeGreaterThanOrEqual(start.top - 0.5);
				expect(Math.max(...bands.map((b) => b.bottom))).toBeLessThanOrEqual(end.bottom + 0.5);
			});
		}
	});
}

// The range grows by keys after it's painted, so the space between blocks has to follow.
test('a range grown with Shift+ArrowDown stays one region', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(QUOTE);
	await editor.focusBlockAtPath([0, 0], 15);
	await editor.shiftClickBlock([1], 0);
	await editor.waitForCrossBlock(true);
	for (const key of ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown']) {
		await page.keyboard.press(key);
		await editor.waitForRenderFlush();
	}
	expect((await editor.bridge.getSelectionPaths())?.focus.path).toEqual([2, 2, 0]);

	await expect.poll(async () => holes(await paintedBands(page))).toEqual([]);
});

// Every line between the first and the last spans the block column, a container's rail, marker
// gutter or indent included.
const NESTED = '- one\n  - nested two words\n  - nested three\n- four\n\nafter\n';

/** [name, document, anchor path, anchor offset, focus path, focus offset] */
const WIDE: [string, string, number[], number, number[], number][] = [
	['from mid-quote, its rail', QUOTE_TO_PARAGRAPH, [0, 0], 6, [1], 5],
	['from a mid nested list item, its indent and markers', NESTED, [0, 0, 1, 0, 0], 3, [1], 3]
];

for (const mode of ['source', 'live']) {
	test.describe(`selection: overlay: every middle line spans the column (${mode})`, () => {
		for (const [name, doc, anchorPath, anchorOffset, focusPath, focusOffset] of WIDE) {
			test(name, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.setPresentationMode(mode);
				await editor.loadContent(doc);
				await editor.focusBlockAtPath(anchorPath, anchorOffset);
				await editor.shiftClickBlock(focusPath, focusOffset);
				await editor.waitForCrossBlock(true);

				await expect.poll(async () => unpaintedMiddle(await paintedRegion(page))).toEqual([]);
			});
		}
	});
}
