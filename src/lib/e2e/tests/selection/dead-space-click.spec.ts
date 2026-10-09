import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { waitForFirstImageLoaded } from '../blocks/image/helpers';
import { pointAtRaw, pointInGap } from '../../text-runs';
import { expectBarAfterWidget } from '../../carets-showing';

// Clicks in the root's own padding and below the last block
// (`requirements/selection/dead-space-click.md`). Both must place a caret: focusing the root
// alone does nothing a user could see.

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

const rootBox = (editor: EditorPage) =>
	editor.page.evaluate(() => {
		const r = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
	}) as Promise<Box>;

const lastBlockBox = (editor: EditorPage) =>
	editor.page.evaluate(() => {
		const blocks = document.querySelectorAll('[data-block-path]:not([data-block-path*=","])');
		const r = (blocks[blocks.length - 1] as HTMLElement).getBoundingClientRect();
		return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
	}) as Promise<Box>;

async function blockBox(editor: EditorPage, index: number): Promise<Box> {
	const r = await editor.getBlock(index).boundingBox();
	if (!r) throw new Error(`no box for block ${index}`);
	return { left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
}

// The band directly under the last block belongs to the tail row (`TailInsert`: a click there
// appends a paragraph), so the dead space these clicks aim at starts below it, inside the root.
async function belowDocumentY(editor: EditorPage): Promise<number> {
	const tail = await editor.page.locator('.editor-tail').boundingBox();
	const root = await rootBox(editor);
	const last = await lastBlockBox(editor);
	return Math.min((tail ? tail.y + tail.height : last.bottom) + 8, root.bottom - 4);
}

// The block's host, whose box is the whole block: a table's grid is narrower than its host.
const blockHost = (editor: EditorPage, index: number) =>
	editor.page.locator(`[data-block-path='${JSON.stringify([index])}']`);

// The middle of the editor's right padding, level with `y`, beside block `index`.
function rightMargin(editor: EditorPage, index: number, y: number) {
	return pointInGap(editor.editorContainer, blockHost(editor, index), 'right', y);
}

// A click at offset 0 of block 0: a click a few pixels into the box lands after the first
// glyph in a proportional face, and the selection then starts one character in.
async function blockStartPoint(editor: EditorPage): Promise<{ x: number; y: number }> {
	return pointAtRaw(editor.page, [0], 0);
}

test.describe('dead-space clicks place a caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a click below the last block lands the caret at its end', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const root = await rootBox(editor);

		await editor.page.mouse.click(root.left + 40, await belowDocumentY(editor));
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('first para\n\nsecond para!');
	});

	test('a click in the right margin lands the caret at the end of that line', async () => {
		// One paragraph long enough to wrap, so "end of that line" and "end of the
		// block" are different answers.
		await editor.loadContent(`${'alpha '.repeat(60).trim()}\n`);
		const para = await blockBox(editor, 0);
		const margin = await rightMargin(editor, 0, para.top + 6);

		await editor.page.mouse.click(margin.x, margin.y);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim().endsWith('!')).toBe(false);
	});

	test('a click below a list lands the caret at the end of its last item', async () => {
		await editor.loadContent('lead\n\n- one\n- two\n');
		const root = await rootBox(editor);

		await editor.page.mouse.click(root.left + 40, await belowDocumentY(editor));
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('lead\n\n- one\n- two!');
	});

	test('a drag-select ending in the margin keeps its selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const start = await blockStartPoint(editor);
		const margin = await rightMargin(editor, 0, start.y);

		await editor.page.mouse.move(start.x, start.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(margin.x, margin.y, { steps: 8 });
		await editor.page.mouse.up();

		expect(await editor.page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(
			'first para'
		);
	});

	// A cross-block range is painted by the overlay with the native selection empty, so the drag
	// guard above cannot see it; left live, the next printable key would replace all of it.
	test('the click ends a live cross-block selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		const para = await blockBox(editor, 0);
		const margin = await rightMargin(editor, 0, para.top + 6);
		await editor.page.mouse.click(margin.x, margin.y);

		// Assert the outcome before the mechanism, so a break fails on "the document was
		// eaten" rather than on a locator timeout for the overlay.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		const source = await editor.bridge.getSource();
		expect(source, 'the stale range type-replaced the document away').toContain('first para');
		expect(source).toContain('third para');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	// A drag from a block released in the margin reports the root as its click target, the common
	// ancestor of down and up, so `click` alone cannot tell it from a dead-space click.
	test('a cross-block drag released in the margin keeps its selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		const root = await rootBox(editor);
		const first = await blockBox(editor, 0);
		const last = await lastBlockBox(editor);

		await editor.page.mouse.move(first.left + 4, first.top + 6);
		await editor.page.mouse.down();
		await editor.page.mouse.move(root.left + 40, last.bottom + 30, { steps: 10 });
		await editor.page.mouse.up();

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	// A table addresses cells, not characters, so a click beside it never lands in a cell, as with a
	// thematic break. Below the document the gap caret's rule applies: a paragraph, never a cell.
	test('a click below a table lands in no cell', async () => {
		await editor.loadContent('lead\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const root = await rootBox(editor);

		await editor.page.mouse.click(root.left + 40, await belowDocumentY(editor));
		await editor.page.keyboard.type('!');
		await editor.waitForNoSourceMutation();

		const source = await editor.bridge.getSource();
		expect(source).toContain('| 1 | 2 |\n');
		expect(source).not.toMatch(/\|[^|\n]*![^|\n]*\|/);
	});

	// Level with a body row, where picking by row would choose that row's cell. No live range here,
	// since collapsing one can itself land in a cell.
	test('a click beside a table lands in no cell', async () => {
		await editor.loadContent('lead\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		const cell = await editor.page.locator('.table-cell').nth(2).boundingBox();
		if (!cell) throw new Error('no box for the first body cell');
		const margin = await rightMargin(editor, 1, cell.y + cell.height / 2);

		await editor.page.mouse.click(margin.x, margin.y);
		await editor.page.keyboard.type('!');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).not.toContain('!');
		const focusedKind = await editor.page.evaluate(() =>
			document.activeElement?.closest('[data-block-kind]')?.getAttribute('data-block-kind')
		);
		expect(focusedKind).not.toBe('table');
	});

	// Chromium paints no caret against a widget the caret cannot enter, so the editor's own bar is
	// the only sign the landing is visible.
	test('a click beside a widget-only line lands the caret on the widget’s edge', async () => {
		await editor.loadContent('lead\n\n![cat](/test-fixtures/sample.png)\n\ntail\n');
		// The row's y is derived from the widget's box, which moves when the <img> decodes.
		await waitForFirstImageLoaded(editor.page);
		const widget = await editor.page.locator('[data-image-widget]').boundingBox();
		if (!widget) throw new Error('no box for the image widget');
		const margin = await rightMargin(editor, 1, widget.y + widget.height / 2);

		await editor.page.mouse.click(margin.x, margin.y);

		await expectBarAfterWidget(editor.page, editor.page.locator('[data-image-widget]'), 'image');
		// The snap lands where the click already resolved, after the image; a real keystroke, since the
		// caret-edge dispatch that reaches a position beside the widget only runs on keydown.
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('Z');
		expect(await editor.bridge.getSource()).toContain('sample.png)Z');
	});

	// A rule holds no character position, so the click declines rather than handing it the
	// whole-block focus that a click on the rule itself means.
	test('a document ending in a thematic break is not focused by the click below it', async () => {
		await editor.loadContent('lead\n\n---\n');
		const root = await rootBox(editor);

		await editor.page.mouse.click(root.left + 40, await belowDocumentY(editor));

		const focusedKind = await editor.page.evaluate(
			() =>
				(document.activeElement as HTMLElement | null)
					?.closest('[data-block-kind]')
					?.getAttribute('data-block-kind') ?? 'none'
		);
		expect(focusedKind).not.toBe('thematicBreak');
	});
});

// A host that widens and pads the block list moves the side gutter onto the list, which reports
// itself as the click target; the `?paddedList=on` harness applies that layout.
test.describe('dead-space clicks in a host-padded block list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?paddedList=on');
	});

	// The block's own box ends short of the list's edge, and the band between is the list's padding.
	const listPadding = (y: number) =>
		pointInGap(editor.page.locator('.editor > .block-list'), blockHost(editor, 0), 'right', y);

	test('a click in the list’s own padding lands the caret at the end of that line', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const para = await blockBox(editor, 0);
		const band = await listPadding(para.top + 6);

		await editor.page.mouse.click(band.x, band.y);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('first para!\n\nsecond para');
	});

	// The mouse-down still tells them apart: a drag from a block reports the list as its click target
	// too, and collapsing there would throw away the selection.
	test('a drag-select released in the list’s padding keeps its selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const start = await blockStartPoint(editor);
		const band = await listPadding(start.y);

		await editor.page.mouse.move(start.x, start.y);
		await editor.page.mouse.down();
		await editor.page.mouse.move(band.x, band.y, { steps: 8 });
		await editor.page.mouse.up();

		expect(await editor.page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(
			'first para'
		);
	});
});
