import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The selection wash is translucent, so two painted rects that share pixels show it twice as
// dark. Every painter is read off the page: the overlay's rects, any element or `::after` filled
// with the wash, and the browser's own selection wherever its `::selection` isn't transparent.
// Requirements: e2e/requirements/selection/overlay-no-overlap.md.

interface Painted {
	who: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

async function paintedHighlights(page: Page): Promise<Painted[]> {
	return page.evaluate(() => {
		const root = document.querySelector('.editor');
		if (!root) throw new Error('no editor');
		const probe = document.createElement('div');
		probe.style.background = 'var(--selection-overlay-bg)';
		root.appendChild(probe);
		const wash = getComputedStyle(probe).backgroundColor;
		probe.remove();

		const out: Painted[] = [];
		const add = (who: string, r: DOMRect): void => {
			if (r.width > 0.5 && r.height > 0.5) {
				out.push({ who, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
			}
		};
		const label = (el: Element): string =>
			`${el.closest('[data-block-path]')?.getAttribute('data-block-path') ?? '-'} ${el.className}`;
		for (const el of root.querySelectorAll('*')) {
			if (getComputedStyle(el).backgroundColor === wash) add(label(el), el.getBoundingClientRect());
			if (getComputedStyle(el, '::after').backgroundColor === wash) {
				add(`${label(el)}::after`, el.getBoundingClientRect());
			}
		}

		const native = getSelection();
		if (native && native.rangeCount > 0 && !native.isCollapsed) {
			const range = native.getRangeAt(0);
			// The browser's own paint: each element's text inside the native range, where it shows.
			for (const el of root.querySelectorAll('*')) {
				const paint = getComputedStyle(el, '::selection').backgroundColor;
				if (paint === 'rgba(0, 0, 0, 0)' || paint === 'transparent') continue;
				for (const node of el.childNodes) {
					if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue;
					const piece = document.createRange();
					piece.selectNodeContents(node);
					if (node === range.startContainer) piece.setStart(node, range.startOffset);
					if (node === range.endContainer) piece.setEnd(node, range.endOffset);
					for (const r of piece.getClientRects()) add(`native ${label(el)}`, r);
				}
			}
		}
		return out;
	});
}

/** Pairs that share more than a hairline in both directions. */
function overlaps(painted: Painted[]): string[] {
	const found: string[] = [];
	for (let i = 0; i < painted.length; i++) {
		for (let j = i + 1; j < painted.length; j++) {
			const a = painted[i];
			const b = painted[j];
			const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
			const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
			if (w > 0.5 && h > 0.5) found.push(`${a.who} × ${b.who}: ${w.toFixed(1)} by ${h.toFixed(1)}`);
		}
	}
	return found;
}

const PROBE =
	'intro\n\nAgreed work that was never picked up, with enough words that it wraps onto a second line in a narrow window\n- alpha\n- beta\n- gamma\n- delta\n\nLoose ends\n';

const KINDS = [
	'## Heading with some words',
	'',
	'A paragraph that is long enough to wrap onto a second line in a narrow window, so the full-line part of the paint shows up as well as the partial first line.',
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
	'',
	'Tail paragraph',
	''
].join('\n');

const RULE = 'alpha words here\n\n---\n\nbeta words here\n';
const TABLE =
	'lead words here\n\n| Ha | Hb | Hc |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n';

/** [name, document, anchor path, anchor offset, focus path, focus offset] */
const RANGES: [string, string, number[], number, number[], number][] = [
	['a paragraph into a list item', PROBE, [1], 3, [2, 3, 0], 2],
	['a heading into a wrapped paragraph', KINDS, [0], 6, [1], 100],
	['a wrapped paragraph into a list item', KINDS, [1], 30, [2, 1, 0], 4],
	['a list item into a quote line', KINDS, [2, 0, 0], 3, [3, 1], 6],
	['a quote line into a code block', KINDS, [3, 0], 6, [4], 12],
	['across a thematic break held whole', RULE, [0], 3, [2], 4],
	['backward, from a list item up into a heading', KINDS, [2, 1, 0], 4, [0], 6]
];

for (const mode of ['source', 'live']) {
	test.describe(`selection: overlay: no two painted rects overlap (${mode})`, () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			// Narrow enough that the long paragraphs wrap.
			await page.setViewportSize({ width: 760, height: 1000 });
			editor = new EditorPage(page);
			await editor.goto();
			await editor.setPresentationMode(mode);
		});

		for (const [name, doc, anchorPath, anchorOffset, focusPath, focusOffset] of RANGES) {
			test(name, async ({ page }) => {
				await editor.loadContent(doc);
				await editor.focusBlockAtPath(anchorPath, anchorOffset);
				await editor.shiftClickBlock(focusPath, focusOffset);
				await editor.waitForCrossBlock(true);

				const painted = await paintedHighlights(page);
				expect(painted.length).toBeGreaterThan(1);
				expect(overlaps(painted)).toEqual([]);
			});
		}

		test('a range ending in a table cell', async ({ page }) => {
			await editor.loadContent(TABLE);
			await editor.focusBlockAtPath([0], 5);
			await page.keyboard.down('Shift');
			await page.locator('.table-cell').nth(4).click();
			await page.keyboard.up('Shift');
			await editor.waitForCrossBlock(true);

			const painted = await paintedHighlights(page);
			expect(painted.length).toBeGreaterThan(1);
			expect(overlaps(painted)).toEqual([]);
		});

		// A line-height under the glyphs' own height makes each row's text box reach into the next.
		test('wrapped rows set tight enough to touch', async ({ page }) => {
			await editor.loadContent(KINDS);
			await page.addStyleTag({
				content: '.editor [contenteditable="true"] { line-height: 1 !important; }'
			});
			await editor.focusBlockAtPath([1], 30);
			await editor.shiftClickBlock([3, 0], 6);
			await editor.waitForCrossBlock(true);

			const painted = await paintedHighlights(page);
			expect(painted.length).toBeGreaterThan(1);
			expect(overlaps(painted)).toEqual([]);
		});

		// A drag inside the rule holds it whole (one box); the range then grows past it.
		test('a range grown out of a rule held whole', async ({ page }) => {
			await editor.loadContent(RULE);
			const rule = (await page.locator('.thematic-break-block').boundingBox())!;
			const y = rule.y + rule.height / 2;
			await page.mouse.move(rule.x + 8, y);
			await page.mouse.down();
			await page.mouse.move(rule.x + rule.width - 8, y, { steps: 8 });
			await page.mouse.up();
			await editor.waitForCrossBlock(true);
			expect(overlaps(await paintedHighlights(page))).toEqual([]);

			// Shift+ArrowDown reaches the start of the paragraph below; Shift+click carries it in.
			await page.keyboard.press('Shift+ArrowDown');
			await editor.shiftClickBlock([2], 9);
			expect(await editor.bridge.getSelectionPaths()).toEqual({
				anchor: { path: [1], offset: 0 },
				focus: { path: [2], offset: 9 }
			});
			const painted = await paintedHighlights(page);
			expect(painted.length).toBeGreaterThan(1);
			expect(overlaps(painted)).toEqual([]);
		});
	});
}
