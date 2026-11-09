import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { textRunRect } from '../../text-runs';

/**
 * Paint from a plugin value (requirements/decorations/paint.md). A plugin's paint is kept per block
 * while the block's bytes hold, so these rows first pin what an edit changes in the tree.
 */

// Every node by path, with its object and its bytes, kept on the page for `changedSince`.
async function keepNodes(page: Page): Promise<void> {
	await page.evaluate(() => {
		const kept: [string, unknown, string][] = [];
		const walk = (node: any, path: number[]) =>
			(node.children ?? []).forEach((child: any, i: number) => {
				kept.push([[...path, i].join(','), child, child.raw]);
				walk(child, [...path, i]);
			});
		walk((window as any).__test.getDocument(), []);
		(window as any).__keptNodes = kept;
	});
}

// The paths whose node is a new object or holds other bytes than at `keepNodes`.
async function changedSince(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const now = new Map<string, any>();
		const walk = (node: any, path: number[]) =>
			(node.children ?? []).forEach((child: any, i: number) => {
				now.set([...path, i].join(','), child);
				walk(child, [...path, i]);
			});
		walk((window as any).__test.getDocument(), []);
		const kept: [string, unknown, string][] = (window as any).__keptNodes;
		return kept
			.filter(([key, node, raw]) => now.get(key) !== node || now.get(key)?.raw !== raw)
			.map(([key]) => key);
	});
}

test.describe('what an edit changes in the tree', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const CASES = [
		{ name: 'a paragraph', md: 'one\n\ntwo\n\nthree\n', path: [1], changed: ['1'] },
		{
			name: "a list item's paragraph",
			md: '- one\n- two\n- three\n',
			path: [0, 1, 0],
			changed: ['0', '0,1', '0,1,0']
		},
		{
			name: "a quote's second paragraph",
			md: '> one\n>\n> two\n>\n> three\n',
			path: [0, 1],
			changed: ['0', '0,1']
		}
	];

	for (const { name, md, path, changed } of CASES) {
		test(`typing in ${name} changes only it and its containers`, async ({ page }) => {
			await editor.loadContent(md);
			await editor.focusBlockAtPath(path, 1);
			await keepNodes(page);
			await editor.typeSlowly('x');
			await editor.bridge.waitForSourceContains('txwo');
			expect((await changedSince(page)).sort()).toEqual([...changed].sort());
		});

		test(`a byte splice in ${name} changes only it and its containers`, async ({ page }) => {
			await editor.loadContent(md);
			await keepNodes(page);
			const at = md.indexOf('two') + 1;
			const spliced = await page.evaluate(
				({ source, at }) => (window as any).__test.spliceSource(source, at),
				{ source: md.slice(0, at) + 'x' + md.slice(at), at: at + 1 }
			);
			expect(spliced).toBe(true);
			await editor.bridge.waitForSourceContains('txwo');
			expect((await changedSince(page)).sort()).toEqual([...changed].sort());
		});
	}
});

// Thirty blocks, each `Block <i> text`, every one marked over `Block`.
const MARKED_BLOCKS = Array.from({ length: 30 }, (_, i) => `Block ${i} text`).join('\n\n') + '\n';

async function measuredAfterTyping(page: Page, editor: EditorPage): Promise<string[]> {
	await editor.focusBlockAtPath([3], 7);
	await editor.waitForRenderFlush();
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.typeSlowly('x');
	await editor.bridge.waitForSourceContains('Block 3x text');
	await editor.waitForRenderFlush();
	return page.evaluate(() => (window as any).__test.perf.snapshot().markMeasurePaths);
}

test.describe('what a keystroke measures again', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(MARKED_BLOCKS);
	});

	test('a whole-document source marking every block measures no block but the edited one', async ({
		page
	}) => {
		await page.evaluate(() =>
			(window as any).__test.decorations.addSource({
				name: 'every-block',
				provide: (doc: { children: unknown[] }) =>
					doc.children.map((_, i) => ({ type: 'mark', path: [i], start: 0, end: 5, class: 'm' }))
			})
		);
		await expect.poll(() => page.locator('.decoration-overlay.m').count()).toBe(30);
		const measured = await measuredAfterTyping(page, editor);
		expect(measured.filter((path) => path !== '3')).toEqual([]);
	});
});

// ── A plugin's paint, through the harness's `?paint=on` probe plugin ─────────

interface Recorded {
	handler: 'hover' | 'activate' | 'click';
	range: [number, number] | null;
	rects: number;
	/** Where the caret was as the handler ran. */
	caret: { path: number[]; offset: number } | null;
}

// A `word` mark over each `needle` in every leaf, its handlers recorded on `window.__marks`;
// `click: 'keep'` adds a click handler that calls `preventDefault`.
async function paintNeedle(
	page: Page,
	needle: string,
	opts: { click?: 'keep' | 'land' } = {}
): Promise<void> {
	await page.evaluate(
		({ needle, click }) => {
			const w = window as any;
			w.__marks = [];
			const caret = () => {
				const focus = w.__test.getSelection()?.focus;
				return focus ? { path: focus.path, offset: focus.offset } : null;
			};
			const record = (handler: string) => (at: any, event?: MouseEvent) => {
				w.__marks.push({
					handler,
					range: at && [at.range.from, at.range.to],
					rects: at ? at.rects.length : 0,
					caret: caret()
				});
				if (click === 'keep') event?.preventDefault();
			};
			const handlers = {
				hover: record('hover'),
				activate: record('activate'),
				...(click ? { click: record('click') } : {})
			};
			w.__test.paint.set((block: any) => {
				if (block.children.length > 0) return [];
				const marks = [];
				for (let i = block.text.indexOf(needle); i >= 0; i = block.text.indexOf(needle, i + 1)) {
					const from = block.byteAt(i);
					marks.push({ type: 'mark', from, to: from + needle.length, class: 'word', ...handlers });
				}
				return marks;
			});
		},
		{ needle, click: opts.click }
	);
}

function recorded(page: Page): Promise<Recorded[]> {
	return page.evaluate(() => [...(window as any).__marks]);
}

async function startCounting(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
}

function paintedPaths(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().paintCallPaths);
}

test.describe('what a plugin paint is asked for', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?paint=on');
	});

	test('a keystroke asks for the edited block and measures only its marks', async ({ page }) => {
		await editor.loadContent(MARKED_BLOCKS);
		await paintNeedle(page, 'Block');
		await expect.poll(() => page.locator('.decoration-overlay.word').count()).toBe(30);
		await editor.focusBlockAtPath([3], 7);
		await editor.waitForRenderFlush();
		await startCounting(page);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('Block 3x text');
		await editor.waitForRenderFlush();
		const counts = await page.evaluate(() => (window as any).__test.perf.snapshot());
		expect(counts.paintCallPaths).toEqual(['3']);
		expect(counts.markMeasurePaths.filter((path: string) => path !== '3')).toEqual([]);
	});

	test('a 25,000-item list paints item 3,500 once it mounts, and never before', async ({
		page
	}) => {
		const list = Array.from({ length: 25_000 }, (_, i) => `- item ${i}`).join('\n') + '\n';
		await editor.loadContent(list);
		await startCounting(page);
		await paintNeedle(page, 'item');
		await expect.poll(() => page.locator('.decoration-overlay.word').count()).toBeGreaterThan(5);
		const first = await paintedPaths(page);
		expect(first).not.toContain('0,3500,0');
		expect(first.length).toBeLessThan(1000);

		const scrollTo = (path: number[]) =>
			page.evaluate((p) => (window as any).__test.rects.scrollTo(p), path);
		await scrollTo([0, 3500]);
		await expect.poll(() => paintedPaths(page)).toContain('0,3500,0');
		await scrollTo([0, 0]);
		await scrollTo([0, 3500]);
		await editor.waitForRenderFlush();
		const item = (await paintedPaths(page)).filter((path) => path === '0,3500,0');
		expect(item).toHaveLength(1);
	});

	test('repaint asks for the blocks it names, or every mounted one and no other', async ({
		page
	}) => {
		const list = Array.from({ length: 5_000 }, (_, i) => `- item ${i}`).join('\n') + '\n';
		await editor.loadContent(list);
		await paintNeedle(page, 'item');
		await expect.poll(() => page.locator('.decoration-overlay.word').count()).toBeGreaterThan(5);
		await startCounting(page);
		const five = list.indexOf('item 5\n');
		await page.evaluate((at) => (window as any).__test.paint.repaint([at]), five);
		await editor.waitForRenderFlush();
		expect(await paintedPaths(page)).toEqual(['0,5,0']);

		await startCounting(page);
		await page.evaluate(() => (window as any).__test.paint.repaint());
		await editor.waitForRenderFlush();
		// Each mounted item's paragraph paints one mark, so the two counts are the same blocks.
		const paragraphs = (await paintedPaths(page)).filter((path) => path.split(',').length === 3);
		expect(paragraphs).toContain('0,5,0');
		expect(paragraphs).toHaveLength(await page.locator('.decoration-overlay.word').count());
	});
});

// The quote's second line and the cell are where a block's text and the document's bytes part.
const PLACES = [
	{ name: 'a paragraph', md: 'one two three\n', path: [0], needle: 'two' },
	{ name: "a quote's second line", md: '> one\n> two three\n', path: [0, 0], needle: 'two' },
	{
		name: 'a table cell',
		md: '| a | b |\n| - | - |\n| one two | x |\n',
		path: [0, 1, 0],
		needle: 'two'
	}
];

test.describe("a painted mark's handlers", () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?paint=on');
		await page.evaluate(
			(command) => (window as any).__test.setKeybindings([{ chord: 'Alt+Enter', command }]),
			'decorations.activateAtCaret'
		);
	});

	for (const { name, md, path, needle } of PLACES) {
		const range: [number, number] = [md.indexOf(needle), md.indexOf(needle) + needle.length];

		test(`in ${name}, a mark paints over its bytes and hover hands it that range`, async ({
			page
		}) => {
			await editor.loadContent(md);
			await paintNeedle(page, needle);
			const overlay = page.locator('.decoration-overlay.word');
			await expect(overlay).toHaveCount(1);
			const glyphs = await textRunRect(page, needle, { path });
			const box = (await overlay.boundingBox())!;
			expect(box.x).toBeCloseTo(glyphs.left, 0);
			expect(box.width).toBeCloseTo(glyphs.width, 0);
			await page.mouse.move(glyphs.left + glyphs.width / 2, glyphs.top + glyphs.height / 2, {
				steps: 4
			});
			await expect.poll(() => recorded(page)).toHaveLength(1);
			expect((await recorded(page))[0]).toMatchObject({ handler: 'hover', range, rects: 1 });
		});

		test(`in ${name}, the keyboard activates a mark with its range`, async ({ page }) => {
			await editor.loadContent(md);
			await paintNeedle(page, needle);
			await expect(page.locator('.decoration-overlay.word')).toHaveCount(1);
			const glyphs = await textRunRect(page, needle, { path });
			await page.mouse.click(glyphs.left + 2, glyphs.top + glyphs.height / 2);
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Alt+Enter');
			await expect
				.poll(async () => (await recorded(page)).filter((r) => r.handler === 'activate'))
				.toMatchObject([{ range, rects: 1 }]);
		});
	}

	test('a click runs before the caret lands, and preventDefault keeps it where it was', async ({
		page
	}) => {
		await editor.loadContent('one two three\n\nfour\n');
		await paintNeedle(page, 'two', { click: 'keep' });
		await editor.focusBlockAtPath([1], 2);
		await page.locator('.decoration-overlay.word').click();
		const clicks = async () => (await recorded(page)).filter((r) => r.handler === 'click');
		await expect.poll(clicks).toMatchObject([{ range: [4, 7], rects: 1 }]);
		expect((await clicks())[0].caret).toEqual({ path: [1], offset: 2 });
		await editor.waitForRenderFlush();
		const focus = await page.evaluate(() => (window as any).__test.getSelection()?.focus);
		expect({ path: focus.path, offset: focus.offset }).toEqual({ path: [1], offset: 2 });

		await paintNeedle(page, 'two', { click: 'land' });
		const glyphs = await textRunRect(page, 'two', { path: [0] });
		await page.mouse.click(glyphs.left + glyphs.width / 2, glyphs.top + glyphs.height / 2);
		await expect.poll(clicks).toHaveLength(1);
		expect((await clicks())[0].caret).toEqual({ path: [1], offset: 2 });
		await expect
			.poll(async () => {
				const at = await page.evaluate(() => (window as any).__test.getSelection()?.focus);
				return at && { path: at.path, inMark: at.offset >= 4 && at.offset <= 7 };
			})
			.toEqual({ path: [0], inMark: true });
	});
});

test.describe('widget, replace and block paint', () => {
	test('each lands, its view told the paint it came from, and leaves on repaint', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto('?paint=on');
		const md = 'one two three\n';
		await editor.loadContent(md);
		const paintWith = (data: string) =>
			page.evaluate(
				({ md, data }) => {
					// A view that shows its paint's `data` and follows it through `update`.
					const view = (cls: string) => (target: HTMLElement, props: any) => {
						const el = document.createElement('span');
						el.className = cls;
						el.textContent = props.paint.data;
						target.append(el);
						return { update: (next: any) => void (el.textContent = next.paint.data) };
					};
					(window as any).__test.paint.set(() => [
						{ type: 'widget', at: md.indexOf('two'), view: view('probe-widget'), data },
						{
							type: 'replace',
							from: md.indexOf('three'),
							to: md.indexOf('three') + 5,
							class: 'gone'
						},
						{ type: 'block', class: 'probe-block', attrs: { 'data-probe': data } },
						{ type: 'block', badge: view('probe-badge'), data }
					]);
				},
				{ md, data }
			);
		await paintWith('W');
		await expect(page.locator('.probe-widget')).toHaveText('W');
		await expect(page.locator('.decoration-island.gone')).toHaveCount(1);
		await expect(page.locator('.probe-block')).toHaveAttribute('data-probe', 'W');
		await expect(page.locator('.decoration-badge .probe-badge')).toHaveText('W');

		await paintWith('V');
		await expect(page.locator('.probe-widget')).toHaveText('V');
		await expect(page.locator('.probe-block')).toHaveAttribute('data-probe', 'V');
		await expect(page.locator('.decoration-badge .probe-badge')).toHaveText('V');

		await page.evaluate(() => (window as any).__test.paint.set(() => []));
		await expect(
			page.locator('.probe-widget, .decoration-island, .probe-block, .probe-badge')
		).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(md);
	});
});
