import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { caretsShowing, drawnBar, oneCaretOnTheBrowsersLine } from '../../carets-showing';
import { textRunEnd, textRunStart } from '../../text-runs';

// The drawn caret against the layout around its editable (requirements/caret/drawn-caret-layout.md):
// a scroller that clips the caret, a size watch it shares with the block it sits in, and a code
// chip's edge, where the bar draws against the chip's own box.

/** Two frames, so a paint armed by the last event has run. */
function nextFrames(page: Page): Promise<unknown> {
	return page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
}

/** A scroller's box and the bar's x, or null for no bar. */
function barAgainst(page: Page, scroller: string) {
	return page.evaluate((scroller) => {
		const box = document.querySelector<HTMLElement>(scroller)!.getBoundingClientRect();
		const bar = document.querySelector('.md-drawn-caret[data-caret-state="text"]');
		const x = bar ? bar.getBoundingClientRect().left : null;
		return { left: box.left, right: box.right, x };
	}, scroller);
}

/** No bar shows, or it shows inside the scroller's box. */
async function noBarOutside(page: Page, scroller: string): Promise<boolean> {
	const { left, right, x } = await barAgainst(page, scroller);
	return x === null || (x >= left && x <= right);
}

test.describe('the drawn caret in a code block scrolled sideways', () => {
	/** Parks the caret at column 60 of a 400-letter code line; returns a point over the block. */
	async function parkInLongLine(page: Page): Promise<{ x: number; y: number }> {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(
			`para\n\n\`\`\`js\nconst value = ${'x'.repeat(400)};\nshort\n\`\`\`\n`
		);
		const block = (await page.locator('.code-block').boundingBox())!;
		await page.mouse.click(block.x + 60, block.y + 20);
		await page.keyboard.press('Home');
		for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
		return { x: block.x + 300, y: block.y + 20 };
	}

	for (const [where, wheel] of [
		['scrolled past the caret', 600],
		['scrolled back short of the caret at the line’s end', -6000]
	] as const) {
		test(`a caret ${where} shows no bar outside the block`, async ({ page }) => {
			const over = await parkInLongLine(page);
			if (wheel < 0) await page.keyboard.press('End');
			await nextFrames(page);
			expect(
				(await barAgainst(page, '.code-block')).x,
				'the bar draws in view first'
			).not.toBeNull();

			await page.mouse.move(over.x, over.y);
			await page.mouse.wheel(wheel, 0);
			await nextFrames(page);

			await expect.poll(() => noBarOutside(page, '.code-block')).toBe(true);
		});
	}

	test('a clipped caret scrolled back into view draws again where the browser paints', async ({
		page
	}) => {
		const over = await parkInLongLine(page);
		await page.mouse.move(over.x, over.y);
		await page.mouse.wheel(600, 0);
		await nextFrames(page);
		await expect.poll(async () => (await barAgainst(page, '.code-block')).x).toBeNull();

		await page.mouse.wheel(-600, 0);

		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});
});

test.describe('the drawn caret in a table scrolled sideways', () => {
	test('a caret in a cell scrolled out of the table’s box shows no bar outside it', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const columns = Array.from({ length: 18 }, (_, i) => `col ${i}`);
		await editor.loadContent(
			`para\n\n| ${columns.join(' | ')} |\n|${' - |'.repeat(18)}\n| ${columns.join(' | ')} |\n`
		);
		const table = (await page.locator('.table-block').boundingBox())!;
		await page.locator('.table-cell').first().click();
		await page.keyboard.press('End');
		await nextFrames(page);
		expect(
			(await barAgainst(page, '.table-block')).x,
			'the bar draws in view first'
		).not.toBeNull();

		await page.mouse.move(table.x + table.width / 2, table.y + 10);
		await page.mouse.wheel(600, 0);
		await nextFrames(page);

		await expect.poll(() => noBarOutside(page, '.table-block')).toBe(true);
	});
});

test.describe('the drawn caret and a table row’s size watch', () => {
	// Counts each size delivery per element tagged `data-probe`, through the editor's own observer.
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			const Real = window.ResizeObserver;
			const hits = new Map<string, number>();
			(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits = hits;
			window.ResizeObserver = class extends Real {
				constructor(callback: ResizeObserverCallback) {
					super((entries, observer) => {
						for (const entry of entries) {
							const id = (entry.target as HTMLElement).dataset?.probe;
							if (id) hits.set(id, (hits.get(id) ?? 0) + 1);
						}
						callback(entries, observer);
					});
				}
			};
		});
	});

	test('a row keeps hearing its first cell grow after the caret visits that cell', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const words = 'long words in the first column that wrap when the cell grows '.repeat(3);
		await editor.loadContent(`para above\n\n| first | second |\n| - | - |\n| ${words} | x |\n`);
		await page.evaluate(() => {
			(document.querySelectorAll('.table-cell')[2] as HTMLElement).dataset.probe = 'first';
		});
		await page.locator('.table-cell').nth(2).click();
		await nextFrames(page);
		await editor.clickBlock(0);
		await nextFrames(page);
		await page.evaluate(() =>
			(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits.clear()
		);

		await page.addStyleTag({ content: '.editor .table-cell { font-size: 26px !important; }' });

		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits.get(
							'first'
						) ?? 0
				)
			)
			.toBeGreaterThan(0);
	});
});

test.describe('the drawn caret at a code chip’s edge, live mode', () => {
	const line = 'see `code` after';

	/** The chip's box on its first and last line, and its first and last glyph's outer edges. */
	function chipBox(page: Page, nth = 0) {
		return page.evaluate((nth) => {
			const chip = document.querySelectorAll<HTMLElement>('.inline-code-content')[nth];
			const rects = [...chip.getClientRects()];
			const text = document.createRange();
			text.selectNodeContents(chip);
			const glyphs = [...text.getClientRects()].filter((r) => r.width > 0);
			const first = rects[0];
			const last = rects[rects.length - 1];
			return {
				left: first.left,
				right: last.right,
				lastTop: last.top,
				lastBottom: last.bottom,
				firstGlyph: glyphs[0].left,
				lastGlyph: glyphs[glyphs.length - 1].right
			};
		}, nth);
	}

	/** The bar's x once it shows in the chip state, with exactly one caret on the page. */
	async function chipBarX(page: Page): Promise<number> {
		await expect.poll(async () => (await drawnBar(page))?.state).toBe('chip');
		expect(await caretsShowing(page)).toEqual({ native: false, drawn: 1 });
		return (await drawnBar(page))!.box.left;
	}

	async function live(page: Page, doc = line): Promise<EditorPage> {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(`${doc}\n`);
		return editor;
	}

	const focusOffset = async (editor: EditorPage) =>
		(await editor.bridge.getSelectionPaths())?.focus.offset ?? -1;

	async function press(editor: EditorPage, key: string): Promise<void> {
		await editor.page.keyboard.press(key);
		await editor.waitForRenderFlush();
	}

	async function typed(editor: EditorPage, want: string): Promise<void> {
		await editor.page.keyboard.type('X');
		await expect.poll(() => editor.bridge.getSource()).toContain(want);
	}

	test('inside at the closer: the bar sits in the chip’s padding, and the letter types inside', async ({
		page
	}) => {
		const editor = await live(page);
		const point = await textRunEnd(page, 'code');
		await page.mouse.click(point.x, point.y);
		const chip = await chipBox(page);
		const x = await chipBarX(page);
		expect(x).toBeGreaterThanOrEqual(chip.lastGlyph - 1);
		expect(x).toBeLessThan(chip.right - 1);
		await typed(editor, 'see `codeX` after');
	});

	test('ArrowRight crosses the border: the bar moves 2px past it, the caret stays', async ({
		page
	}) => {
		const editor = await live(page);
		const point = await textRunEnd(page, 'code');
		await page.mouse.click(point.x, point.y);
		await chipBarX(page);
		const at = await focusOffset(editor);
		await press(editor, 'ArrowRight');
		const chip = await chipBox(page);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		expect(await focusOffset(editor)).toBe(at);
		await typed(editor, 'see `code`X after');
	});

	test('a second ArrowRight moves the caret past the space', async ({ page }) => {
		const editor = await live(page);
		const point = await textRunEnd(page, 'code');
		await page.mouse.click(point.x, point.y);
		await press(editor, 'ArrowRight');
		await press(editor, 'ArrowRight');
		await typed(editor, 'see `code` Xafter');
	});

	test('the opener mirrors it: inside at the first letter, ArrowLeft 2px before the border', async ({
		page
	}) => {
		const editor = await live(page);
		const point = await textRunStart(page, 'code');
		await page.mouse.click(point.x, point.y);
		const chip = await chipBox(page);
		const inside = await chipBarX(page);
		expect(inside).toBeGreaterThan(chip.left + 1);
		expect(inside).toBeLessThanOrEqual(chip.firstGlyph + 1);
		await press(editor, 'ArrowLeft');
		expect(Math.abs((await chipBarX(page)) - (chip.left - 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, 'see X`code` after');
	});

	test('a click just right of the chip paints outside and types outside', async ({ page }) => {
		const editor = await live(page);
		const chip = await chipBox(page);
		await page.mouse.click(chip.right + 1, (chip.lastTop + chip.lastBottom) / 2);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, 'see `code`X after');
	});

	test('a click in the chip’s padding paints inside and types inside', async ({ page }) => {
		const editor = await live(page);
		const chip = await chipBox(page);
		await page.mouse.click(chip.right - 1, (chip.lastTop + chip.lastBottom) / 2);
		const x = await chipBarX(page);
		expect(x).toBeLessThan(chip.right - 1);
		await typed(editor, 'see `codeX` after');
	});

	test('a wrapped chip: the bar uses the box on the chip’s last line', async ({ page }) => {
		const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
		const editor = await live(page, `see \`${words} end\` after`);
		const point = await textRunEnd(page, 'end');
		await page.mouse.click(point.x, point.y);
		await chipBarX(page);
		await press(editor, 'ArrowRight');
		const chip = await chipBox(page);
		const bar = (await drawnBar(page))!.box;
		expect(Math.abs(bar.left - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		expect(bar.top + bar.height / 2).toBeGreaterThan(chip.lastTop);
		expect(bar.top + bar.height / 2).toBeLessThan(chip.lastBottom);
	});

	for (const [where, keys] of [
		['inside', []],
		['outside', ['ArrowRight']]
	] as const) {
		test(`Backspace with the bar ${where} the closer deletes the letter drawn left of it`, async ({
			page
		}) => {
			const editor = await live(page);
			const point = await textRunEnd(page, 'code');
			await page.mouse.click(point.x, point.y);
			await chipBarX(page);
			for (const key of keys) await press(editor, key);
			await press(editor, 'Backspace');
			await expect.poll(() => editor.bridge.getSource()).toContain('see `cod` after');
		});
	}

	test('inside the chip, off its edges: the bar draws where the browser paints', async ({
		page
	}) => {
		const editor = await live(page);
		await editor.focusBlock(0, 'see `co'.length);

		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});

	test('in a table cell, ArrowRight crosses the border and the letter types past it', async ({
		page
	}) => {
		const editor = await live(page, '| h | h2 |\n| - | - |\n| a `cee` | z |');
		const point = await textRunEnd(page, 'cee');
		await page.mouse.click(point.x, point.y);
		await chipBarX(page);
		await press(editor, 'ArrowRight');
		const chip = await chipBox(page);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, '| a `cee`X | z |');
	});

	// For Daniel's try: End means the end of the line as drawn, which is past the chip's border.
	test('End on a line ending in a chip lands outside it', async ({ page }) => {
		const editor = await live(page, 'see `code`');
		const point = await textRunEnd(page, 'see');
		await page.mouse.click(point.x - 4, point.y);
		await press(editor, 'End');
		const chip = await chipBox(page);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, 'see `code`X');
	});

	// For Daniel's try: every stop is a visible pixel, so ArrowLeft into a chip stops past its border
	// first, then inside it, then moves into its text.
	test('ArrowLeft into a chip from the text after it stops outside the border first', async ({
		page
	}) => {
		const editor = await live(page);
		const point = await textRunStart(page, 'after');
		await page.mouse.click(point.x, point.y);
		await press(editor, 'ArrowLeft');
		const chip = await chipBox(page);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await press(editor, 'ArrowLeft');
		expect(await chipBarX(page)).toBeLessThan(chip.right - 1);
		await typed(editor, 'see `codeX` after');
	});

	/** Every x the bar is written at while `key` is pressed, read off the bar's own writes. */
	async function barXsAcross(editor: EditorPage, key: string): Promise<number[]> {
		await editor.page.evaluate(() => {
			const bar = document.querySelector<HTMLElement>('.md-drawn-caret')!;
			const seen: number[] = [];
			(window as unknown as { __barXs: number[] }).__barXs = seen;
			new MutationObserver(() => seen.push(bar.getBoundingClientRect().left)).observe(bar, {
				attributes: true
			});
		});
		await press(editor, key);
		await nextFrames(editor.page);
		return editor.page.evaluate(() => (window as unknown as { __barXs: number[] }).__barXs);
	}

	// Miss-analysis: the arrival rows read the bar once it settled, so none saw the frame it was
	// first painted at the inside stop.
	for (const [key, doc, from] of [
		['ArrowLeft', line, 'after'],
		['End', 'see `code`', 'see']
	] as const) {
		test(`${key} onto a chip's closer paints no frame at the inside stop`, async ({ page }) => {
			const editor = await live(page, doc);
			const point = key === 'End' ? await textRunEnd(page, from) : await textRunStart(page, from);
			await page.mouse.click(key === 'End' ? point.x - 4 : point.x, point.y);
			await expect.poll(async () => (await drawnBar(page))?.state).toBe('text');
			const chip = await chipBox(page);
			const xs = await barXsAcross(editor, key);
			expect(xs.length, 'the bar moved').toBeGreaterThan(0);
			expect(xs.filter((x) => Math.abs(x - chip.lastGlyph) <= 1)).toEqual([]);
			expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		});
	}

	test('End twice on a line ending in a chip stays outside', async ({ page }) => {
		const editor = await live(page, 'see `code`');
		const point = await textRunEnd(page, 'see');
		await page.mouse.click(point.x - 4, point.y);
		await press(editor, 'End');
		await press(editor, 'End');
		const chip = await chipBox(page);
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, 'see `code`X');
	});

	test('End from the chip’s inside stop lands outside it', async ({ page }) => {
		const editor = await live(page, 'see `code`');
		const point = await textRunEnd(page, 'code');
		await page.mouse.click(point.x, point.y);
		const chip = await chipBox(page);
		expect(await chipBarX(page)).toBeLessThan(chip.right - 1);
		await press(editor, 'End');
		expect(Math.abs((await chipBarX(page)) - (chip.right + 2))).toBeLessThanOrEqual(0.5);
		await typed(editor, 'see `code`X');
	});
});
