import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { caretsShowing, drawnBar, type DrawnBar } from '../../carets-showing';
import { textRunRect } from '../../text-runs';
import { waitForAllImagesLoaded } from '../blocks/image/helpers';
import { edgeKey } from '../../platform-keys';

// Requirements: `requirements/caret/caret-shows.md`. Beside a picture, whatever route put the caret
// there, the bar stands where the next letter lands, as tall as the engine's bar for that line.

const IMG = '![x](/test-fixtures/photos/field-120x80.png)';
const LINKED = `[${IMG}](https://x.y)`;

interface Row {
	name: string;
	/** The block holding the picture, which comes first; an empty paragraph follows it. */
	source: string;
	path: number[];
	arrive: (editor: EditorPage, page: Page) => Promise<void>;
	/** The picture's block once `Q` is typed. */
	typed: string;
	/** A raw offset in text on the picture's line, whose bar the engine draws text-height; absent
	 *  where the line holds no text, so an empty paragraph's bar is the height to match. */
	textAt?: number;
}

async function clickPast(page: Page): Promise<void> {
	const picture = (await page.locator('[data-image-widget]').first().boundingBox())!;
	await page.mouse.click(picture.x + picture.width + 60, picture.y + picture.height / 2);
}

const ROWS: Row[] = [
	{
		name: 'Backspace on the empty paragraph below a picture',
		source: IMG,
		path: [0],
		arrive: async (editor, page) => {
			await editor.focusBlockStart(1);
			await page.keyboard.press('Backspace');
		},
		typed: `${IMG}Q`
	},
	{
		name: 'a click past a picture',
		source: IMG,
		path: [0],
		arrive: (_, page) => clickPast(page),
		typed: `${IMG}Q`
	},
	{
		name: 'a caret put at a picture’s end',
		source: IMG,
		path: [0],
		arrive: (editor) => editor.focusBlockEnd(0),
		typed: `${IMG}Q`
	},
	{
		name: 'an undo of a letter typed after a picture',
		source: IMG,
		path: [0],
		arrive: async (editor, page) => {
			await editor.focusBlockEnd(0);
			await page.keyboard.type('Z');
			await expect.poll(() => editor.bridge.getSource()).toContain(`${IMG}Z`);
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => editor.bridge.getSource()).not.toContain('Z');
		},
		typed: `${IMG}Q`
	},
	{
		name: 'Enter after a picture, then Backspace',
		source: IMG,
		path: [0],
		arrive: async (editor, page) => {
			const blocks = await editor.bridge.getBlockCount();
			await editor.focusBlockEnd(0);
			await page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockCount()).toBe(blocks + 1);
			await page.keyboard.press('Backspace');
		},
		typed: `${IMG}Q`
	},
	{
		name: 'a caret put at a picture’s start',
		source: IMG,
		path: [0],
		arrive: (editor) => editor.focusBlockStart(0),
		typed: `Q${IMG}`
	},
	{
		name: 'Home from a picture’s end',
		source: IMG,
		path: [0],
		arrive: async (editor, page) => {
			await editor.focusBlockEnd(0);
			await page.keyboard.press(edgeKey('lineStart'));
		},
		typed: `Q${IMG}`
	},
	{
		name: 'Backspace on the empty paragraph below a linked picture',
		source: LINKED,
		path: [0],
		arrive: async (editor, page) => {
			await editor.focusBlockStart(1);
			await page.keyboard.press('Backspace');
		},
		typed: `${LINKED}Q`
	},
	{
		name: 'a caret put at a linked picture’s end',
		source: LINKED,
		path: [0],
		arrive: (editor) => editor.focusBlockEnd(0),
		typed: `${LINKED}Q`
	},
	{
		name: 'a caret put at a linked picture’s start',
		source: LINKED,
		path: [0],
		arrive: (editor) => editor.focusBlockStart(0),
		typed: `Q${LINKED}`
	},
	{
		name: 'a click past a picture in a list item',
		source: `- ${IMG}`,
		path: [0, 0, 0],
		arrive: (_, page) => clickPast(page),
		typed: `${IMG}Q`
	},
	{
		name: 'a caret put before a picture in a list item',
		source: `- ${IMG}`,
		path: [0, 0, 0],
		arrive: (editor) => editor.focusBlockAtPath([0, 0, 0], 0),
		typed: `Q${IMG}`
	},
	{
		name: 'a click past a picture in a quote',
		source: `> ${IMG}`,
		path: [0, 0],
		arrive: (_, page) => clickPast(page),
		typed: `${IMG}Q`
	},
	{
		name: 'a caret put after a picture that follows text',
		source: `lead ${IMG}`,
		path: [0],
		arrive: (editor) => editor.focusBlockEnd(0),
		typed: `lead ${IMG}Q`
	},
	{
		name: 'a caret put between two pictures',
		source: `${IMG}${IMG}`,
		path: [0],
		arrive: (editor) => editor.focusBlock(0, IMG.length),
		typed: `${IMG}Q${IMG}`
	},
	{
		name: 'a caret put before a picture with text after it',
		source: `${IMG} trail`,
		path: [0],
		arrive: (editor) => editor.focusBlockStart(0),
		typed: `Q${IMG} trail`,
		textAt: `${IMG} tr`.length
	}
];

const middle = (box: { top: number; height: number }) => box.top + box.height / 2;

/** The bar showing now, alone: no browser caret beside it. */
async function theBar(page: Page, state: string): Promise<DrawnBar> {
	await expect.poll(async () => (await drawnBar(page))?.state).toBe(state);
	expect(await caretsShowing(page)).toEqual({ native: false, drawn: 1 });
	return (await drawnBar(page))!;
}

/** The bar stands where `Q` landed: its left and middle within 1px, `height` within 1px. */
async function expectBarAtQ(page: Page, bar: DrawnBar, path: number[], height: number) {
	const q = await textRunRect(page, 'Q', { path });
	const want = { left: q.left, middle: middle(q), height };
	const got = { left: bar.box.left, middle: middle(bar.box), height: bar.box.height };
	for (const key of ['left', 'middle', 'height'] as const) {
		expect(
			Math.abs(got[key] - want[key]),
			`${key} ${got[key]} vs ${want[key]}`
		).toBeLessThanOrEqual(1);
	}
}

test.describe('the caret beside a picture stands where the next letter lands', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const row of ROWS) {
		test(row.name, async ({ page }) => {
			await editor.loadContent(`${row.source}\n\n\n\nafter\n`);
			await waitForAllImagesLoaded(page);
			if (row.textAt === undefined) await editor.focusBlockStart(1);
			else await editor.focusBlockAtPath(row.path, row.textAt);
			const lineBar = (await theBar(page, 'text')).box.height;

			await row.arrive(editor, page);
			await editor.waitForRenderFlush();
			const bar = await theBar(page, 'widget');
			await page.keyboard.type('Q');
			await expect.poll(() => editor.bridge.getSource()).toContain(row.typed);
			await expectBarAtQ(page, bar, row.path, lineBar);
		});
	}

	// A decoded entity sits in a line, where the browser draws its own caret, so the bar stays away.
	test('a caret put after an entity at a line’s end keeps the browser’s caret', async ({
		page
	}) => {
		await editor.loadContent('lead &copy;\n');
		await editor.focusBlockEnd(0);
		await editor.waitForRenderFlush();
		expect((await drawnBar(page))?.state ?? 'native').not.toBe('widget');
		await page.keyboard.type('Q');
		await expect.poll(async () => (await editor.bridge.getSource()).trimEnd()).toBe('lead &copy;Q');
	});
});

const INLINE_WIDGETS = [
	{ name: 'a decoded entity', seed: null, source: 'lead &copy;' },
	{ name: 'an emoji', seed: 'emoji', source: 'lead :tada:' },
	{ name: 'a formula', seed: 'math', source: 'lead $x^2$' }
] as const;

test.describe('the bar a click past a text-height widget asks for', () => {
	for (const widget of INLINE_WIDGETS) {
		test(`stands where the next letter lands beside ${widget.name}`, async ({ page }) => {
			const editor = new PluginsPage(page);
			if (widget.seed) await editor.gotoPlugins(widget.seed);
			else await editor.goto();
			await editor.setPresentationMode('live');
			await editor.loadContent(`${widget.source}\n`);
			const box = (await page.locator('[data-inline-widget]').first().boundingBox())!;
			await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
			await editor.waitForRenderFlush();
			const bar = await theBar(page, 'widget');
			await page.keyboard.type('Q');
			await expect.poll(() => editor.bridge.getSource()).toContain(`${widget.source}Q`);
			// The caret after Q is the engine's own text bar on that line, drawn on the same rows.
			await expectBarAtQ(page, bar, [0], (await theBar(page, 'text')).box.height);
		});
	}
});
