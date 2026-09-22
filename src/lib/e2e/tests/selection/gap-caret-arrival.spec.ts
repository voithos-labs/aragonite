import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	AT_BOUNDARY,
	AT_DOC_START,
	CLOSER_BOUNDARY,
	FENCE,
	FENCE_THEN_TABLE,
	LAST_CELL,
	LEADING_TABLE,
	TABLE_THEN_FENCE,
	loadThenArrive
} from './gap-caret-fixtures';

// Arrival at a between-blocks caret and the plain exits back out
// (`requirements/selection/gap-caret-arrival.md`). Blocks are addressed by CST path through the
// bridge: the chained block locator costs minutes on the windowed fixture below.

// Root blocks sit flush against each other, so the one strip with no block band that a click
// can reach is the editor's leading padding: the document's own start boundary.
async function leadingPaddingPoint(editor: EditorPage): Promise<{ x: number; y: number }> {
	return editor.page.evaluate(() => {
		const root = document.querySelector('.editor')!.getBoundingClientRect();
		const first = document.querySelector("[data-block-path='[0]']")!.getBoundingClientRect();
		return { x: first.left + 8, y: (root.top + first.top) / 2 };
	});
}

test.describe('gap caret arrival', () => {
	let editor: EditorPage;

	const proxyHoldsFocus = () =>
		editor.page.evaluate(() => !!document.activeElement?.closest('[data-gap-caret]'));

	/** How many visual lines a fence opener takes is up to the browser, not the editor, so the
	 *  loop is bounded rather than counted. Four is twice the most this fixture can need: one
	 *  press onto the opener's own line, one more to leave the block. */
	const pressUpToBoundary = async () => {
		for (let press = 0; press < 4; press++) {
			await editor.page.keyboard.press('ArrowUp');
			if ((await editor.bridge.getGapCaret()) !== null) return;
		}
		throw new Error('ArrowUp never reached the gap caret');
	};

	const focusedBlockPath = () =>
		editor.page.evaluate(
			() =>
				document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ??
				null
		);

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the fixtures are the block sequences the boundaries assume', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		expect(await editor.bridge.getBlockKind(1)).toBe('table');
		expect(await editor.bridge.getBlockKind(2)).toBe('fencedCode');

		await editor.loadContent(FENCE_THEN_TABLE);
		expect(await editor.bridge.getBlockKind(1)).toBe('fencedCode');
		expect(await editor.bridge.getBlockKind(2)).toBe('table');
	});

	test('ArrowDown out of the last table cell puts the caret at the boundary, and again enters the fence', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.page.locator('.table-cell').nth(LAST_CELL).click();

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		await expect.poll(proxyHoldsFocus).toBe(true);

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('Xcode');
	});

	test('ArrowUp from the fence body puts the caret at the same boundary, and again enters the table', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.focusBlockAtPath([2], 4);

		await pressUpToBoundary();
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);

		await editor.page.keyboard.press('ArrowUp');
		await editor.bridge.waitForGapCaret(null);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('| c | dX |');
	});

	test('Backspace at fence offset 0 puts the caret at the boundary above it', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		await editor.focusBlockAtPath([2], 0);

		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		expect(await editor.bridge.getSource()).toBe(TABLE_THEN_FENCE);
	});

	// The sibling case that keeps the fallback honest: a paragraph declares no edge, so the
	// boundary is not eligible and focus enters the paragraph as usual.
	test('Backspace at fence offset 0 below a paragraph still enters the paragraph', async () => {
		await editor.loadContent(`para\n\n${FENCE}`);
		await editor.focusBlockAtPath([1], 0);

		await editor.page.keyboard.press('Backspace');
		await editor.typeText('X');

		await editor.bridge.waitForSourceContains('paraX');
		expect(await editor.bridge.getGapCaret()).toBeNull();
	});

	test('Delete at the fence closer puts the caret at the boundary below it', async () => {
		await editor.loadContent(FENCE_THEN_TABLE);
		await editor.focusBlockAtPath([1], CLOSER_BOUNDARY);

		await editor.page.keyboard.press('Delete');

		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		expect(await editor.bridge.getSource()).toBe(FENCE_THEN_TABLE);
	});

	test('a click above a leading table puts the caret at the document start', async () => {
		await editor.loadContent(LEADING_TABLE);
		const point = await leadingPaddingPoint(editor);

		await editor.page.mouse.click(point.x, point.y);

		await editor.bridge.waitForGapCaret(AT_DOC_START);
		await expect.poll(proxyHoldsFocus).toBe(true);
	});

	// At index 0 there is no block above, so the backward exits keep the gap rather than
	// dropping the caret out of the document; Escape takes the forward branch instead.
	test('the document-start gap keeps the caret on a backward exit and yields to Escape', async () => {
		await editor.loadContent(LEADING_TABLE);
		await editor.page.mouse.click(
			(await leadingPaddingPoint(editor)).x,
			(await leadingPaddingPoint(editor)).y
		);
		await editor.bridge.waitForGapCaret(AT_DOC_START);

		await editor.page.keyboard.press('ArrowUp');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getGapCaret()).toEqual(AT_DOC_START);

		await editor.page.keyboard.press('Escape');
		await editor.bridge.waitForGapCaret(null);
		await expect.poll(focusedBlockPath).toBe('[0]');
	});

	test('a click above a leading paragraph still lands in the paragraph', async () => {
		await editor.loadContent(TABLE_THEN_FENCE);
		const point = await leadingPaddingPoint(editor);

		await editor.page.mouse.click(point.x, point.y);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		// The band search clamps into block 0's box, so the offset is the click's own x: what
		// this pins is the block it landed in, not where inside it.
		expect((await editor.bridge.getSource()).split('\n')[0]).toContain('X');
		expect(await editor.bridge.getGapCaret()).toBeNull();
	});

	// G2.12: a caret placement ends a live cross-block range, and the gap is a caret.
	test('a gap-landing click ends a live cross-block range in the same gesture', async () => {
		await editor.loadContent(LEADING_TABLE);
		// From the trailing paragraph: a select-all started in a table cell leaves a live
		// native range behind, which the click's drag guard declines before any of this.
		await editor.focusBlockStart(2);
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);
		const point = await leadingPaddingPoint(editor);

		await editor.page.mouse.click(point.x, point.y);

		await editor.bridge.waitForGapCaret(AT_DOC_START);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		expect(await editor.bridge.getSource()).toBe(LEADING_TABLE);
	});
});

test.describe('gap caret keys', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Escape dismisses to the block above, the same branch ArrowUp takes.
	const EXITS = [
		{ key: 'ArrowDown', lands: 'the fence', typed: 'Xcode' },
		{ key: 'ArrowRight', lands: 'the fence', typed: 'Xcode' },
		{ key: 'Delete', lands: 'the fence', typed: 'Xcode' },
		{ key: 'ArrowUp', lands: 'the table', typed: '| c | dX |' },
		{ key: 'ArrowLeft', lands: 'the table', typed: '| c | dX |' },
		{ key: 'Backspace', lands: 'the table', typed: '| c | dX |' },
		{ key: 'Escape', lands: 'the table', typed: '| c | dX |' }
	];

	for (const exit of EXITS) {
		test(`${exit.key} leaves the gap for ${exit.lands}`, async () => {
			await loadThenArrive(editor);

			await editor.page.keyboard.press(exit.key);
			await editor.bridge.waitForGapCaret(null);
			await editor.typeText('X');

			await editor.bridge.waitForSourceContains(exit.typed);
		});
	}
});

test.describe('gap caret in reading mode', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=reading');
		await editor.loadContent(LEADING_TABLE);
	});

	// The click is the case that tells them apart here: reading mode focuses no block, so no
	// traversal runs to check. That branch is unit-pinned (`editor-actions/focus`).
	test('a click in an eligible band puts the caret nothing', async () => {
		const point = await leadingPaddingPoint(editor);

		await editor.page.mouse.click(point.x, point.y);
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getGapCaret()).toBeNull();
	});
});
