import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { gotoReady } from '../../goto-ready';
import { pointAtRaw, textRunRect, type Point, type TextRunRect } from '../../text-runs';
import { FIXTURE_BYTES } from '../perf/vr-helpers';
import { skipUnlessSupported } from '../../browser-engine';
import { multiClick } from '../../multi-click';
import { isMacOS } from '../../platform-keys';

/**
 * Mark hover (requirements/decorations/mark-hover.md). Each source records its `onHover` calls on
 * `window.__hovers`, an anchor as plain numbers and an end as null. The pointer aims at the text
 * the mark covers, never at an overlay element: a hover-only mark renders none that takes it.
 */

type Recorded = { cls: string; anchor: { left: number; top: number; width: number } | null };

interface MarkSpec {
	path: number[];
	start: number;
	end: number;
	cls: string;
	click?: boolean;
}

/** Registers a hover source whose marks the page can swap with `window.__setMarks(name, marks)`. */
async function addHoverSource(page: Page, name: string, marks: MarkSpec[]): Promise<void> {
	await page.evaluate(
		({ name, marks }) => {
			const w = window as any;
			w.__hovers ??= [];
			w.__clicks ??= 0;
			w.__marks ??= {};
			w.__marks[name] = marks;
			w.__setMarks = (source: string, next: MarkSpec[]) => {
				w.__marks[source] = next;
				w.__test.decorations.invalidateSource(source);
			};
			w.__test.decorations.addSource({
				name,
				provide: () =>
					w.__marks[name].map((m: MarkSpec) => ({
						type: 'mark',
						path: m.path,
						start: m.start,
						end: m.end,
						class: m.cls,
						interactive: {
							onHover: (dec: { class: string }, hover: { anchor: DOMRect } | null) => {
								w.__hovers.push({
									cls: dec.class,
									anchor: hover
										? { left: hover.anchor.left, top: hover.anchor.top, width: hover.anchor.width }
										: null
								});
							},
							...(m.click ? { onClick: () => w.__clicks++ } : {})
						}
					}))
			});
		},
		{ name, marks }
	);
}

function hovers(page: Page): Promise<Recorded[]> {
	return page.evaluate(() => [...((window as any).__hovers ?? [])]);
}

function center(r: TextRunRect): Point {
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function moveTo(page: Page, at: Point, steps = 4): Promise<void> {
	await page.mouse.move(at.x, at.y, { steps });
}

/** Somewhere on the page no mark covers: the harness's top-left corner, above the editor. */
async function moveAway(page: Page): Promise<void> {
	await page.mouse.move(2, 2, { steps: 4 });
}

/** The run so far, once it has stopped changing for two reads in a row. */
async function settledHovers(page: Page): Promise<Recorded[]> {
	let last = JSON.stringify(await hovers(page));
	await expect
		.poll(async () => {
			const now = JSON.stringify(await hovers(page));
			const stable = now === last;
			last = now;
			return stable;
		})
		.toBe(true);
	return hovers(page);
}

async function hoverWord(page: Page, needle: string, path: number[] = [0]): Promise<Point> {
	const at = center(await textRunRect(page, needle, { path }));
	await moveTo(page, at);
	await expect.poll(() => hovers(page)).not.toHaveLength(0);
	return at;
}

test.describe('mark hover', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('entering a one-line mark reports its rect, and leaving reports one end', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'one', [{ path: [0], start: 0, end: 5, cls: 'hv-one' }]);
		const word = await textRunRect(page, 'hello', { path: [0] });

		await hoverWord(page, 'hello');
		const [start] = await hovers(page);
		expect(start.anchor).toEqual({
			left: expect.closeTo(word.left, 0),
			top: expect.closeTo(word.top, 0),
			width: expect.closeTo(word.width, 0)
		});

		await moveAway(page);
		expect(await settledHovers(page)).toEqual([start, { cls: 'hv-one', anchor: null }]);
	});

	test('crossing between the lines of a wrapped mark fires nothing; leaving it ends once', async ({
		page
	}) => {
		const line = 'word '.repeat(120).trim();
		await editor.loadContent(`${line}\n`);
		await addHoverSource(page, 'wrap', [{ path: [0], start: 0, end: line.length, cls: 'hv-wrap' }]);
		const lines: { top: number; bottom: number; left: number }[] = await page.evaluate(
			(end) =>
				(window as any).__test.rects
					.rangeRects([0], 0, end)
					.map((r: DOMRect) => ({ top: r.top, bottom: r.bottom, left: r.left })),
			line.length
		);
		const [first, second] = [lines[0], lines.find((r) => r.top > lines[0].bottom)!];
		expect(second.top, 'the space between the lines is real').toBeGreaterThan(first.bottom);
		const x = first.left + 200;
		await moveTo(page, { x, y: (first.top + first.bottom) / 2 });
		await expect.poll(() => hovers(page)).toHaveLength(1);
		// Straight down, in small steps, so the pointer passes through the space between the lines.
		await moveTo(page, { x, y: (second.top + second.bottom) / 2 }, 12);
		expect(await settledHovers(page)).toHaveLength(1);

		await moveAway(page);
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});

	test('a re-provided mark keeps its hover, and a removed one ends it once', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'live', [{ path: [0], start: 0, end: 5, cls: 'hv-live' }]);
		await hoverWord(page, 'hello');

		await page.evaluate(() => {
			const w = window as any;
			w.__setMarks('live', [{ path: [0], start: 0, end: 5, cls: 'hv-live' }]);
			w.__setMarks('live', [{ path: [0], start: 0, end: 5, cls: 'hv-live hv-hovered' }]);
		});
		await expect(page.locator('.decoration-overlay.hv-hovered')).toHaveCount(1);
		expect(await settledHovers(page), 'a repaint fired a leave/enter pair').toHaveLength(1);

		await page.evaluate(() => (window as any).__setMarks('live', []));
		await expect(page.locator('.decoration-overlay.hv-live')).toHaveCount(0);
		const run = await settledHovers(page);
		expect(run.slice(1)).toEqual([{ cls: 'hv-live hv-hovered', anchor: null }]);
	});

	test('scrolling a little under a still pointer ends the hover once', async ({ page }) => {
		await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		await addHoverSource(page, 'near', [{ path: [0], start: 0, end: 4, cls: 'hv-near' }]);
		const word = await page.evaluate(() => {
			const [r] = (window as any).__test.rects.rangeRects([0], 0, 4);
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		});
		await moveTo(page, { x: (word.left + word.right) / 2, y: (word.top + word.bottom) / 2 });
		await expect.poll(() => hovers(page)).toHaveLength(1);

		await editor.scrollEditorTo(120);
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});

	test('scrolling the hovered block out of the rendered range ends its hover once', async ({
		page
	}) => {
		const count = await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		await addHoverSource(page, 'far', [{ path: [0], start: 0, end: 4, cls: 'hv-far' }]);
		const word = await page.evaluate(() => {
			const [r] = (window as any).__test.rects.rangeRects([0], 0, 4);
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		});
		await moveTo(page, { x: (word.left + word.right) / 2, y: (word.top + word.bottom) / 2 });
		await expect.poll(() => hovers(page)).toHaveLength(1);

		await page.evaluate((last) => (window as any).__test.rects.scrollTo([last]), count - 1);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.isBlockMounted([0])))
			.toBe(false);
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});

	test('replacing the document ends the hover once', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'swap', [{ path: [0], start: 0, end: 5, cls: 'hv-swap' }]);
		await hoverWord(page, 'hello');

		// The source keeps offering the same mark, so only the swap itself can end the hover.
		await editor.loadContent('hello again\n');
		const run = await settledHovers(page);
		expect(run.slice(0, 2).map((r) => r.anchor === null)).toEqual([false, true]);
		expect(run.filter((r) => r.anchor === null)).toHaveLength(1);
	});

	test('unmounting the editor ends the hover once', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'gone', [{ path: [0], start: 0, end: 5, cls: 'hv-gone' }]);
		await hoverWord(page, 'hello');

		// The host's own toggle remounts the editor under `{#key}`; clicked from script so the
		// pointer stays on the mark and only the unmount can end the hover.
		await page.evaluate(() => {
			const label = [...document.querySelectorAll('label')].find((l) =>
				/drag handles/i.test(l.textContent ?? '')
			);
			label!.querySelector('input')!.click();
		});
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});

	test('over two overlapping marks, the inner one hovers whatever the source order', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'inner', [{ path: [0], start: 2, end: 4, cls: 'hv-inner' }]);
		await addHoverSource(page, 'outer', [{ path: [0], start: 0, end: 11, cls: 'hv-outer' }]);
		await moveTo(page, await pointAtRaw(page, [0], 2));
		await expect.poll(() => hovers(page)).not.toHaveLength(0);
		const run = await settledHovers(page);
		expect(run.at(-1)?.cls).toBe('hv-inner');
	});

	test('a click inside a hover-only mark places the caret there', async ({ page }) => {
		await editor.loadContent('hello world\n\nsecond\n');
		await addHoverSource(page, 'caret', [{ path: [0], start: 0, end: 5, cls: 'hv-caret' }]);
		await editor.focusBlockEnd(1);

		const at = await pointAtRaw(page, [0], 3);
		await page.mouse.click(at.x, at.y);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSelection()?.focus))
			.toEqual({ path: [0], offset: 3 });
	});

	test('a drag from inside a hover-only mark selects, and holds no hover while pressed', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'drag', [
			{ path: [0], start: 0, end: 5, cls: 'hv-drag' },
			{ path: [0], start: 6, end: 11, cls: 'hv-other' }
		]);
		await hoverWord(page, 'hello');

		await page.mouse.down();
		await moveTo(page, center(await textRunRect(page, 'world', { path: [0] })), 8);
		await page.mouse.up();

		const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected.length).toBeGreaterThan(3);
		expect('hello world').toContain(selected);
		const run = await settledHovers(page);
		expect(run.map((r) => [r.cls, r.anchor === null])).toEqual([
			['hv-drag', false],
			['hv-drag', true]
		]);
	});

	test('a double-click inside a hover-only mark selects the word', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'word', [{ path: [0], start: 0, end: 5, cls: 'hv-word' }]);
		const at = center(await textRunRect(page, 'hello', { path: [0] }));

		await multiClick(page, at, 2);
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('hello');
	});

	test("a right-click inside a hover-only mark places the caret and opens the editor's menu", async ({
		page
	}) => {
		await editor.loadContent('hello world\n\nsecond\n');
		await addHoverSource(page, 'menu', [{ path: [0], start: 0, end: 5, cls: 'hv-menu' }]);
		await editor.focusBlockEnd(1);
		const at = await pointAtRaw(page, [0], 3);

		await page.mouse.click(at.x, at.y, { button: 'right' });
		await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
		// macOS selects the word under a right-click, as Safari does, and the menu keeps it.
		const word = { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 5 } };
		expect(await page.evaluate(() => (window as any).__test.getSelection())).toMatchObject(
			isMacOS ? word : { focus: { path: [0], offset: 3 } }
		);
	});

	test('a hover-only mark shows the text cursor, not a hand', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'cursor', [{ path: [0], start: 0, end: 5, cls: 'hv-cursor' }]);
		await expect(page.locator('.decoration-overlay.hv-cursor')).toHaveCount(1);
		const at = center(await textRunRect(page, 'hello', { path: [0] }));

		const cursor = await page.evaluate(
			({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
			at
		);
		expect(cursor).not.toBe('pointer');
	});

	test('only click marks take pointer events: hover-only, keyboard-only and plain take none', async ({
		page
	}) => {
		await editor.loadContent('hello world and more words\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'mixed',
				provide: () => [
					...Array.from({ length: 200 }, (_, i) => ({
						type: 'mark',
						path: [0],
						start: i % 10,
						end: (i % 10) + 1,
						class: 'hv-plain'
					})),
					{
						type: 'mark',
						path: [0],
						start: 0,
						end: 5,
						class: 'hv-kbd',
						interactive: { onActivate: () => {} }
					},
					{
						type: 'mark',
						path: [0],
						start: 6,
						end: 11,
						class: 'hv-h',
						interactive: { onHover: () => {} }
					},
					{
						type: 'mark',
						path: [0],
						start: 12,
						end: 15,
						class: 'hv-h',
						interactive: { onHover: () => {} }
					},
					{
						type: 'mark',
						path: [0],
						start: 16,
						end: 20,
						class: 'hv-c',
						interactive: { onClick: () => {} }
					},
					{
						type: 'mark',
						path: [0],
						start: 21,
						end: 26,
						class: 'hv-c',
						interactive: { onClick: () => {}, onHover: () => {} }
					}
				]
			});
		});
		await expect(page.locator('.decoration-overlay')).toHaveCount(205);
		const taking = await page
			.locator('.decoration-overlay')
			.evaluateAll((els) =>
				els.filter((el) => getComputedStyle(el).pointerEvents !== 'none').map((el) => el.className)
			);
		expect(taking).toHaveLength(2);
		expect(taking.every((cls) => cls.includes('hv-c'))).toBe(true);
	});

	test('a host popup inside the editor, over another mark, does not hover that mark', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await addHoverSource(page, 'pop', [
			{ path: [0], start: 0, end: 5, cls: 'hv-a' },
			{ path: [0], start: 6, end: 11, cls: 'hv-b' }
		]);
		await hoverWord(page, 'hello');

		const b = await textRunRect(page, 'world', { path: [0] });
		await page.evaluate((r) => {
			const popup = document.createElement('div');
			popup.className = 'host-popup';
			Object.assign(popup.style, {
				position: 'fixed',
				left: `${r.left - 4}px`,
				top: `${r.top - 4}px`,
				width: `${r.width + 8}px`,
				height: `${r.height + 8}px`,
				zIndex: '50',
				background: 'white'
			});
			document.querySelector('.editor')!.appendChild(popup);
		}, b);
		await moveTo(page, center(b), 8);

		const run = await settledHovers(page);
		expect(run.map((r) => [r.cls, r.anchor === null])).toEqual([
			['hv-a', false],
			['hv-a', true]
		]);
	});

	test('a menu a table opens over its own cells does not hover the cell under it', async ({
		page
	}) => {
		await editor.loadContent(
			'| Alpha | Beta |\n| --- | --- |\n| charlie | delta |\n| echo | fox |\n'
		);
		const cells: MarkSpec[] = [];
		const texts = [
			['Alpha', 'Beta'],
			['charlie', 'delta'],
			['echo', 'fox']
		];
		texts.forEach((row, r) =>
			row.forEach((text, c) =>
				cells.push({ path: [0, r, c], start: 0, end: text.length, cls: `hv-r${r}c${c}` })
			)
		);
		await addHoverSource(page, 'cells', cells);
		const opened = await hoverWord(page, 'Alpha', [0, 0, 0]);

		await page.mouse.click(opened.x, opened.y, { button: 'right' });
		const menu = (await page.locator('.table-action-menu').boundingBox())!;
		// Inside the menu and over the next row's text, which carries a hover mark.
		const below = await textRunRect(page, 'charlie', { path: [0, 1, 0] });
		const over = { x: Math.max(menu.x + 4, below.left + 4), y: center(below).y };
		expect(over.x, 'the menu covers the next row').toBeLessThan(below.right);
		expect(over.y, 'the menu covers the next row').toBeLessThan(menu.y + menu.height);
		await moveTo(page, over, 8);

		const run = await settledHovers(page);
		expect(run.map((r) => [r.cls, r.anchor === null])).toEqual([
			['hv-r0c0', false],
			['hv-r0c0', true]
		]);
	});

	test('a throwing onHover reaches the error event and the editor keeps working', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await page.evaluate(() => {
			const w = window as any;
			w.__test.startErrorCapture();
			w.__test.decorations.addSource({
				name: 'boom',
				provide: () => [
					{
						type: 'mark',
						path: [0],
						start: 0,
						end: 5,
						class: 'hv-boom',
						interactive: {
							onHover: () => {
								throw new Error('plugin onHover blew up');
							}
						}
					}
				]
			});
		});
		await moveTo(page, center(await textRunRect(page, 'hello', { path: [0] })));
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getCapturedErrors()))
			.toContain('decoration');

		await editor.focusBlockEnd(0);
		await editor.typeText('!');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource()))
			.toBe('hello world!\n');
	});
});

test.describe('mark hover under touch', () => {
	test.use({ hasTouch: true });

	test('a touch tap on a hover mark places the caret and starts no hover', async ({ page }) => {
		skipUnlessSupported(page, 'touch');
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('hello world\n\nsecond\n');
		await addHoverSource(page, 'tap', [{ path: [0], start: 0, end: 5, cls: 'hv-tap' }]);
		await editor.focusBlockEnd(1);
		// Inside the mark's last glyph, where a click's nearest boundary and WebKit's tap, which
		// lands on a word edge, agree.
		const at = await pointAtRaw(page, [0], 5, 'before');

		await page.touchscreen.tap(at.x, at.y);
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSelection()?.focus))
			.toEqual({ path: [0], offset: 5 });
		expect(await settledHovers(page)).toEqual([]);
	});
});

// Host scroll mode, both shapes: the window scrolls (`/test/page-scroll`), or a scroller between
// the editor and the window does (`/test/flow`). Neither scroll repaints an overlay.
test.describe('mark hover under host scrolling', () => {
	/** Records hovers on `window.__hovers` from a mark on `path` 0..9, through `registry`. */
	const recordHovers = (registry: string, path: number[]) =>
		`(() => {
			const w = window;
			w.__hovers = [];
			${registry}.addSource({
				name: 'host-scroll',
				provide: () => [{
					type: 'mark', path: ${JSON.stringify(path)}, start: 0, end: 9, class: 'hv-host',
					interactive: { onHover: (dec, hover) => w.__hovers.push({ cls: dec.class, anchor: hover ? { left: hover.anchor.left, top: hover.anchor.top, width: hover.anchor.width } : null }) }
				}]
			});
		})()`;

	async function hoverRect(
		page: Page,
		r: { left: number; top: number; right: number; bottom: number }
	) {
		await moveTo(page, { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
		await expect.poll(() => hovers(page)).toHaveLength(1);
	}

	test('the page scrolling a little under a still pointer ends the hover once', async ({
		page
	}) => {
		await gotoReady(page, '/test/page-scroll?blocks=40');
		await page.evaluate(recordHovers('w.__test.decorations', [2]));
		await expect(page.locator('.decoration-overlay.hv-host')).toHaveCount(1);
		const [word] = await page.evaluate(() =>
			(window as any).__test.rects
				.rangeRects([2], 0, 9)
				.map((r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
		);
		await hoverRect(page, word);

		await page.evaluate(() => window.scrollBy(0, 120));
		// The scroll event lands a frame later, so wait for the end before reading the whole run.
		await expect.poll(() => hovers(page)).toHaveLength(2);
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});

	test('a host scroller scrolling a little under a still pointer ends the hover once', async ({
		page
	}) => {
		await gotoReady(page, '/test/flow');
		const scroller = page.getByTestId('scroller');
		await scroller.evaluate((el) => (el.scrollTop = 1000));
		await page.evaluate(recordHovers("w.__flow.decorations('a')", [3]));
		await expect(page.locator('.decoration-overlay.hv-host')).toHaveCount(1);
		const [word] = await page.evaluate(() => (window as any).__flow.rangeRects('a', [3], 0, 9));
		await hoverRect(page, word);

		await scroller.evaluate((el) => (el.scrollTop += 120));
		// The scroll event lands a frame later, so wait for the end before reading the whole run.
		await expect.poll(() => hovers(page)).toHaveLength(2);
		const run = await settledHovers(page);
		expect(run.map((r) => r.anchor === null)).toEqual([false, true]);
	});
});
