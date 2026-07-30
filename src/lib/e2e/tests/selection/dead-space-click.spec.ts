import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Clicks in the root's own padding and below the last block
// (requirements/selection/dead-space-click.md). Both used to focus the root and
// place no caret, so the click did nothing a user could see.

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

test.describe('dead-space clicks place a caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const rootBox = () =>
		editor.page.evaluate(() => {
			const r = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
			return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
		}) as Promise<Box>;

	const lastBlockBox = () =>
		editor.page.evaluate(() => {
			const blocks = document.querySelectorAll('[data-block-path]:not([data-block-path*=","])');
			const r = (blocks[blocks.length - 1] as HTMLElement).getBoundingClientRect();
			return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
		}) as Promise<Box>;

	async function blockBox(index: number): Promise<Box> {
		const r = await editor.getBlock(index).boundingBox();
		if (!r) throw new Error(`no box for block ${index}`);
		return { left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
	}

	test('a click below the last block lands the caret at its end', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const root = await rootBox();
		const last = await lastBlockBox();

		await editor.page.mouse.click(root.left + 40, last.bottom + 40);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('first para\n\nsecond para!');
	});

	test('a click in the right margin lands the caret at the end of that line', async () => {
		// One paragraph long enough to wrap, so "end of that line" and "end of the
		// block" are different answers.
		await editor.loadContent(`${'alpha '.repeat(60).trim()}\n`);
		const root = await rootBox();
		const para = await blockBox(0);

		await editor.page.mouse.click(root.right - 5, para.top + 6);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		const source = await editor.bridge.getSource();
		expect(source).toContain('!');
		expect(source.trim().endsWith('!')).toBe(false);
	});

	test('a click below a list lands the caret at the end of its last item', async () => {
		await editor.loadContent('lead\n\n- one\n- two\n');
		const root = await rootBox();
		const last = await lastBlockBox();

		await editor.page.mouse.click(root.left + 40, last.bottom + 30);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('lead\n\n- one\n- two!');
	});

	test('a drag-select ending in the margin keeps its selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const root = await rootBox();
		const para = await blockBox(0);

		await editor.page.mouse.move(para.left + 4, para.top + 6);
		await editor.page.mouse.down();
		await editor.page.mouse.move(root.right - 5, para.top + 6, { steps: 8 });
		await editor.page.mouse.up();

		expect(await editor.page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(
			'first para'
		);
	});

	// A cross-block range is overlay-painted with the native selection empty, so the
	// drag guard above cannot see it. Left live, the range stays painted over the
	// caret this click just placed and the next printable key type-replaces all of it.
	test('the click ends a live cross-block selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		const root = await rootBox();
		const para = await blockBox(0);
		await editor.page.mouse.click(root.right - 5, para.top + 6);

		// Assert the outcome before the mechanism, so a regression reds on "the
		// document was eaten" rather than on a locator timeout for the overlay.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		const source = await editor.bridge.getSource();
		expect(source, 'the stale range type-replaced the document away').toContain('first para');
		expect(source).toContain('third para');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	// A drag that started ON a block and released in the margin reports the ROOT as
	// its click target — the common ancestor of press and release — so `click` alone
	// cannot tell it from a dead-space click.
	test('a cross-block drag released in the margin keeps its selection', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		const root = await rootBox();
		const first = await blockBox(0);
		const last = await lastBlockBox();

		await editor.page.mouse.move(first.left + 4, first.top + 6);
		await editor.page.mouse.down();
		await editor.page.mouse.move(root.left + 40, last.bottom + 30, { steps: 10 });
		await editor.page.mouse.up();

		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	// A table addresses cells, not characters, so it answers the clamped probe point
	// through its own descriptor hook. Below the document that point is the block
	// box's trailing corner, which names the last row's last cell.
	test('a click below a table lands the caret in the last row’s nearest cell', async () => {
		await editor.loadContent('lead\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const root = await rootBox();
		const last = await lastBlockBox();

		await editor.page.mouse.click(root.left + 40, last.bottom + 30);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect(await editor.bridge.getSource()).toContain('| 1 | 2! |');
	});

	// Beside the table, y picks the row — so this lands in a MIDDLE row, which is what
	// separates "nearest cell" from "the last cell". The x→column half is pinned at the
	// unit layer (`table-caret-at-point.test.ts`, and the col-0 arm of
	// `dead-space-caret-routing.test.ts`), because a dead-space click is only in the
	// root's own padding, where x is always clamped to a box edge.
	//
	// Driven with a live cross-block range on purpose. Beside a block the browser's own
	// caret placement reaches the same cell, so the landing alone proves nothing about
	// whose answer it is; the range does. A declined click leaves it painted and the
	// next key type-replaces the whole document, where a claimed one ends it and types
	// into the cell.
	test('a click beside a table lands in that row and ends a live range', async () => {
		await editor.loadContent('lead\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);

		const root = await rootBox();
		// Cell index 2 is the first body row's first cell.
		const cell = await editor.page.locator('[role="cell"]').nth(2).boundingBox();
		if (!cell) throw new Error('no box for the first body cell');

		await editor.page.mouse.click(root.right - 5, cell.y + cell.height / 2);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		const source = await editor.bridge.getSource();
		expect(source, 'the stale range type-replaced the document away').toContain('lead');
		expect(source).toContain('| 1 | 2! |');
		expect(source).toContain('| 3 | 4 |');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	// A rule holds no character position, so the click declines rather than handing
	// it the whole-block focus a click ON the rule means.
	test('a document ending in a thematic break is not focused by the click below it', async () => {
		await editor.loadContent('lead\n\n---\n');
		const root = await rootBox();
		const last = await lastBlockBox();

		await editor.page.mouse.click(root.left + 40, last.bottom + 30);

		const focusedKind = await editor.page.evaluate(
			() =>
				(document.activeElement as HTMLElement | null)
					?.closest('[data-block-kind]')
					?.getAttribute('data-block-kind') ?? 'none'
		);
		expect(focusedKind).not.toBe('thematicBreak');
	});
});
