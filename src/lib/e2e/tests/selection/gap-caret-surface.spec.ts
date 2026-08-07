import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The gap caret's SURFACE: what it paints, and every way the caret leaves it that is not a
// mint (requirements/selection/gap-caret-surface.md). Minting and undo are
// gap-caret-editing.spec.ts.

const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const FENCE = '```\ncode\n```\n';
const TABLE_THEN_FENCE = `para\n\n${TABLE}\n${FENCE}\ntail\n`;
const LAST_CELL = 3;
const AT_BOUNDARY = { parentPath: [], index: 2 };

const LINE = '[data-gap-caret] .gap-caret-line';

async function arriveAtBoundary(editor: EditorPage): Promise<void> {
	await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
	await editor.page.keyboard.press('ArrowDown');
	await editor.bridge.waitForGapCaret(AT_BOUNDARY);
}

test.describe('the gap caret paints a line at the boundary', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_THEN_FENCE);
	});

	test('nothing paints while no gap is live', async () => {
		await expect(editor.page.locator(LINE)).toHaveCount(0);
	});

	// Not opacity: the line blinks, so an opacity read is a coin flip. Height, box and
	// colour are what a user would call "there and visible".
	test('a live gap paints a visible line spanning the content column', async () => {
		await arriveAtBoundary(editor);

		const line = editor.page.locator(LINE);
		await expect(line).toHaveCount(1);
		const painted = await line.evaluate((el) => {
			const style = getComputedStyle(el);
			const list = el.closest('.block-list')!.getBoundingClientRect();
			return {
				display: style.display,
				visibility: style.visibility,
				height: style.height,
				background: style.backgroundColor,
				spansColumn: Math.round(el.getBoundingClientRect().width) === Math.round(list.width)
			};
		});
		expect(painted.display).not.toBe('none');
		expect(painted.visibility).toBe('visible');
		expect(painted.height).toBe('2px');
		expect(painted.background).not.toBe('rgba(0, 0, 0, 0)');
		expect(painted.spansColumn).toBe(true);
	});

	// The gap is deliberately outside the public `SelectionPoint` union, so a subscriber must
	// be told the caret LEFT the block it was in. The state write alone cannot say so — it
	// fires while DOM focus is still in the source block, so the settling emission is the
	// proxy's own range moving, and a filter over that would strand the stale position.
	test('a subscriber is left reading no selection once the gap settles', async () => {
		await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
		await editor.page.evaluate(() => (window as any).__test.startSelectionChangeCapture());

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret(AT_BOUNDARY);
		await editor.waitForRenderFlush();

		const emissions: { anchor: unknown }[] = await editor.page.evaluate(() =>
			(window as any).__test.stopSelectionChangeCapture()
		);
		expect(emissions.at(-1)).toEqual({ anchor: null, focus: null });
		expect(await editor.bridge.getSelection()).toBeNull();
	});

	// Zero-height flow: the boundary keeps the layout it had without the caret in it.
	test('the line adds no layout of its own', async () => {
		const before = await editor.page
			.locator("[data-block-path='[2]']")
			.evaluate((el) => el.getBoundingClientRect().top);

		await arriveAtBoundary(editor);

		const after = await editor.page
			.locator("[data-block-path='[2]']")
			.evaluate((el) => el.getBoundingClientRect().top);
		expect(after).toBe(before);
	});
});

test.describe('a presentation-mode flip ends the gap', () => {
	// #88: the gap outlived the flip, leaving a caret in a surface with no editing at all.
	test('flipping to reading clears it, and flipping back does not bring it back', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_THEN_FENCE);
		await arriveAtBoundary(editor);

		// Flip WITHOUT moving DOM focus: a toggle click blurs the proxy, and onFocusOut then
		// clears the gap before the choke point ever runs — the flip must be the only actor.
		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));

		await editor.bridge.waitForGapCaret(null);
		// The choke point is what closes #88; this second read is the belt, and it is
		// non-discriminating on its own — a cleared gap renders no proxy either way.
		await expect(page.locator('[data-gap-caret] [contenteditable="true"]')).toHaveCount(0);

		await page.evaluate(() => (window as any).__test.setPresentationMode('source'));
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getGapCaret()).toBeNull();
	});
});

test.describe('leaving the gap without minting', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE_THEN_FENCE);
	});

	// v1: extending a selection out of a gap would need a "whole block selected" state that
	// is not representable, so Shift+Arrow is exactly the plain arrow.
	for (const arrow of [
		{ key: 'ArrowDown', typed: 'Xcode' },
		{ key: 'ArrowUp', typed: '| c | dX |' }
	]) {
		test(`Shift+${arrow.key} exits like the plain ${arrow.key}`, async () => {
			await arriveAtBoundary(editor);

			await editor.page.keyboard.press(`Shift+${arrow.key}`);
			await editor.bridge.waitForGapCaret(null);
			expect(await editor.bridge.isCrossBlockActive()).toBe(false);

			await editor.typeText('X');
			await editor.bridge.waitForSourceContains(arrow.typed);
		});
	}

	// The shift arm builds its anchor from the focused element, and the proxy is not a block:
	// it degrades to the plain-click landing instead of anchoring on nothing.
	test('a shift-click out of a live gap lands like a plain click', async () => {
		await arriveAtBoundary(editor);

		await editor.shiftClickBlock([0], 2);

		await editor.bridge.waitForGapCaret(null);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		expect((await editor.bridge.getSource()).split('\n')[0]).toContain('X');
	});

	test('focus leaving the editor entirely clears the gap', async ({ page }) => {
		await arriveAtBoundary(editor);
		await page.evaluate(() => {
			const outside = document.createElement('button');
			outside.id = 'outside-editor';
			document.body.append(outside);
		});

		await page.locator('#outside-editor').focus();

		await editor.bridge.waitForGapCaret(null);
	});
});
