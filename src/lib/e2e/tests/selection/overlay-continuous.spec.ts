import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { holes, paintedBands, type Band } from './painted-region';

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
