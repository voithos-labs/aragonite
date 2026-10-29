import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey } from '../../platform-keys';
import { pointAtRaw, textRunRect } from '../../text-runs';
import { caretsShowing, oneCaretOnTheBrowsersLine } from '../../carets-showing';
import { engineSupports } from '../../browser-engine';
import { waitForImagesDecoded } from '../blocks/image/helpers';

/**
 * Where a line soft-wraps, the caret's spot is both one line's end and the next line's start, and
 * every key that decides by the caret's line asks the browser which one it shows
 * (`requirements/keyboard-navigation/caret-line-at-wrap.md`).
 */

const PARA =
	'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
	'incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud ' +
	'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor';
// One line each, reaching well past the middle, so a landing shows its column.
const BEFORE = 'before, one line that reaches far right';
const AFTER = 'after, one line that reaches far right';
// Wider than what's left of line 1 after the text before it, so it starts line 2.
const IMAGE = '![x|300x40](/test-fixtures/sample.png)';

// Fixed, so the paragraph wraps at the same words on every engine and every host.
const EDITOR_WIDTH = '.editor { width: 420px !important; max-width: 420px !important; }';

interface Shape {
	name: string;
	source: string;
	/** The wrapped leaf, with `before` above it and `after` below. */
	path: number[];
	before: number[];
	after: number[];
}

const SHAPES: Shape[] = [
	{
		name: 'a paragraph',
		source: `${BEFORE}\n\n${PARA}\n\n${AFTER}\n`,
		path: [1],
		before: [0],
		after: [2]
	},
	{
		name: 'a list item',
		source: `${BEFORE}\n\n- ${PARA}\n\n${AFTER}\n`,
		path: [1, 0, 0],
		before: [0],
		after: [2]
	}
];

const CELL: Shape = {
	name: 'a table cell',
	source: `${BEFORE}\n\n| a | b |\n| - | - |\n| ${PARA} | x |\n\n${AFTER}\n`,
	path: [1, 1, 0],
	before: [0],
	after: [2]
};

/** The raw offset each visual line of the leaf at `path` starts at. */
function lineStarts(page: Page, path: number[], length = PARA.length): Promise<number[]> {
	return page.evaluate(
		({ path, length }) => {
			const probes = (window as any).__test;
			const starts = [0];
			let lastY: number | null = null;
			for (let raw = 0; raw < length; raw++) {
				const point = probes.pointAtRaw(path, raw, 'after');
				if (!point) continue;
				if (lastY !== null && Math.abs(point.y - lastY) > 4) starts.push(raw);
				lastY = point.y;
			}
			return starts;
		},
		{ path, length }
	);
}

async function load(editor: EditorPage, shape: Shape): Promise<number[]> {
	await editor.page.addStyleTag({ content: EDITOR_WIDTH });
	await editor.loadContent(shape.source);
	const starts = await lineStarts(editor.page, shape.path);
	// Six lines at this width; the rows need a first, a middle and a last line.
	expect(starts.length).toBeGreaterThanOrEqual(4);
	return starts;
}

/** Home or End on visual line `line`, reached from inside it so the key decides the side. */
async function lineEdge(
	editor: EditorPage,
	shape: Shape,
	starts: number[],
	line: number,
	side: 'start' | 'end'
) {
	await editor.focusBlockAtPath(shape.path, starts[line] + 3);
	await editor.page.keyboard.press(edgeKey(side === 'start' ? 'lineStart' : 'lineEnd'));
}

async function focusOf(editor: EditorPage) {
	await editor.waitForRenderFlush();
	return (await editor.bridge.getSelectionPaths())?.focus;
}

async function selectionOf(editor: EditorPage) {
	await editor.waitForRenderFlush();
	return editor.bridge.getSelectionPaths();
}

/** The question the editor asks at a wrap, asked by hand: to the line's end, and back to its start
 *  if that moved. */
function askLineEnd(page: Page): Promise<{ moved: boolean; back: boolean }> {
	return page.evaluate(() => {
		const sel = window.getSelection()!;
		const node = sel.focusNode;
		const offset = sel.focusOffset;
		const alter = sel.isCollapsed ? 'move' : 'extend';
		sel.modify(alter, 'forward', 'lineboundary');
		const moved = sel.focusNode !== node || sel.focusOffset !== offset;
		if (moved) sel.modify(alter, 'backward', 'lineboundary');
		return { moved, back: sel.focusNode === node && sel.focusOffset === offset };
	});
}

// ── What the browser does with the question ────────────────────────────

test.describe('asking the browser where the line ends', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const asked of [false, true]) {
		const label = asked ? 'asked' : 'not asked';

		test(`End on line 1, ArrowDown, ${label}: the same landing`, async ({ page }) => {
			const starts = await load(editor, SHAPES[0]);
			await lineEdge(editor, SHAPES[0], starts, 0, 'end');
			if (asked) expect(await askLineEnd(page)).toEqual({ moved: false, back: true });
			await page.keyboard.press('ArrowDown');
			const focus = await focusOf(editor);
			// Line 1 is shorter than line 2, so the column lands inside line 2, short of its end.
			expect(focus?.offset).toBeGreaterThan(starts[1]);
			expect(focus?.offset).toBeLessThan(starts[2]);
		});

		for (const shape of SHAPES) {
			test(`Home on line 2 of ${shape.name}, ${label}: still line 2`, async ({ page }) => {
				const starts = await load(editor, shape);
				await lineEdge(editor, shape, starts, 1, 'start');
				if (asked) expect(await askLineEnd(page)).toEqual({ moved: true, back: true });
				await page.keyboard.press(`Shift+${edgeKey('lineStart')}`);
				const range = await selectionOf(editor);
				expect(range?.anchor).toEqual({ path: shape.path, offset: starts[1] });
				expect(range?.focus).toEqual({ path: shape.path, offset: starts[1] });
			});
		}

		test(`Home on line 2 of a paragraph, ${label}: ArrowDown keeps the column`, async ({
			page
		}) => {
			const starts = await load(editor, SHAPES[0]);
			await lineEdge(editor, SHAPES[0], starts, 1, 'start');
			if (asked) await askLineEnd(page);
			await page.keyboard.press('ArrowDown');
			expect(await focusOf(editor)).toEqual({ path: [1], offset: starts[2] });
		});

		test(`an image starting the next line, ${label}: the caret stays put`, async ({
			page,
			browserName
		}) => {
			test.fixme(
				asked && browserName === 'chromium',
				'#ISSUE: Chromium’s line start skips a picture opening a wrapped line, so the way back lands after it'
			);
			await editor.page.addStyleTag({ content: EDITOR_WIDTH });
			await editor.loadContent(`before\n\nalpha beta gamma ${IMAGE} tail\n\nafter\n`);
			await waitForImagesDecoded(page.locator('.editor img'));
			const line1 = await textRunRect(page, 'alpha', { path: [1] });
			const image = (await page.locator('[data-image-widget]').boundingBox())!;
			expect(image.y, 'the image starts line 2').toBeGreaterThanOrEqual(line1.bottom - 1);
			await editor.focusBlock(1, 'alpha beta gamma '.length);
			const at = await selectionOf(editor);
			if (asked) expect((await askLineEnd(page)).back).toBe(true);
			expect(await selectionOf(editor)).toEqual(at);
		});
	}

	// Before a picture opening line 2 with no space after it, the editor asks, and the way back
	// skips the picture the same way.
	for (const [key, landing] of [
		['ArrowUp', 'the block before'],
		['ArrowDown', 'line 2']
	] as const) {
		test(`before an image starting the next line, ${key}: ${landing}`, async ({
			page,
			browserName
		}) => {
			test.fixme(
				browserName === 'chromium',
				'#ISSUE: Chromium’s line start skips a picture opening a wrapped line, so the way back lands after it'
			);
			await editor.page.addStyleTag({ content: EDITOR_WIDTH });
			const lead = 'alpha beta gamma ';
			await editor.loadContent(`before\n\n${lead}${IMAGE}tail\n\nafter\n`);
			await waitForImagesDecoded(page.locator('.editor img'));
			const line1 = await textRunRect(page, 'alpha', { path: [1] });
			const image = (await page.locator('[data-image-widget]').boundingBox())!;
			expect(image.y, 'the image starts line 2').toBeGreaterThanOrEqual(line1.bottom - 1);
			await editor.focusBlock(1, lead.length);
			await page.keyboard.press(key);
			const focus = await focusOf(editor);
			if (key === 'ArrowUp') expect(focus?.path).toEqual([0]);
			else {
				expect(focus?.path).toEqual([1]);
				expect(focus!.offset).toBeGreaterThanOrEqual(lead.length);
			}
		});
	}

	test('End on a short line 1 of two, ArrowDown: line 2 at the column, inside it', async ({
		page
	}) => {
		await page.addStyleTag({ content: EDITOR_WIDTH });
		// A word too long for line 1 makes it the short one; search for one that still fits line 2,
		// since how many letters fit a line depends on the platform's font.
		let starts: number[] = [];
		for (let length = 10; length < 80 && !(starts.length === 2 && starts[1] === 5); length++) {
			const text = `Tiny ${'abcdefghij'.repeat(8).slice(0, length)}`;
			await editor.loadContent(`before\n\n${text}\n\nafter\n`);
			starts = await lineStarts(page, [1], text.length);
		}
		expect(starts).toEqual([0, 5]);
		await editor.focusBlock(1, 2);
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('ArrowDown');
		const focus = await focusOf(editor);
		expect(focus?.path).toEqual([1]);
		expect(focus!.offset).toBeGreaterThan(5);
		expect(focus!.offset).toBeLessThan(15);
	});

	test('a run of ArrowDown through a short line’s end keeps the column it started with', async ({
		page
	}) => {
		await page.addStyleTag({ content: EDITOR_WIDTH });
		// A word too long for line 2 leaves it short, ending at a wrap.
		const text = `${'abcd '.repeat(10)}tiny ${'x'.repeat(40)} ${PARA}`;
		await editor.loadContent(`before\n\n${text}\n\nafter\n`);
		const starts = await lineStarts(page, [1], text.length);
		await editor.focusBlock(1, 3);
		await page.keyboard.press(edgeKey('lineEnd'));
		const column = (await pointAtRaw(page, [1], starts[1], 'before')).x;
		await page.keyboard.press('ArrowDown');
		expect(await focusOf(editor)).toEqual({ path: [1], offset: starts[2] });
		const shortEnd = (await pointAtRaw(page, [1], starts[2], 'before')).x;
		await page.keyboard.press('ArrowDown');
		const landed = (await pointAtRaw(page, [1], (await focusOf(editor))!.offset, 'before')).x;
		expect(Math.abs(landed - column)).toBeLessThan(Math.abs(landed - shortEnd));
	});

	test('an arrow that asks leaves no trace of the question', async ({ page }) => {
		const starts = await load(editor, SHAPES[0]);
		const depth = await editor.bridge.getUndoDepth();
		await lineEdge(editor, SHAPES[0], starts, 1, 'start');
		await page.keyboard.press('ArrowUp');
		const range = await selectionOf(editor);
		expect(range?.anchor).toEqual(range?.focus);
		await expect(page.locator('[data-testid="selection-toolbar"]')).toHaveCount(0);
		expect(await editor.bridge.getUndoDepth()).toBe(depth);
		expect(await caretsShowing(page)).toMatchObject({ drawn: 1 });
		if (engineSupports(page, 'caretScreenshot')) await oneCaretOnTheBrowsersLine(page);
	});
});

// ── Leaving the block, or not ──────────────────────────────────────────

for (const shape of SHAPES) {
	test.describe(`the caret's line at a wrap, in ${shape.name}`, () => {
		let editor: EditorPage;
		let starts: number[];

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto();
			starts = await load(editor, shape);
		});

		const onLine = async (line: number) => {
			const focus = await focusOf(editor);
			expect(focus?.path).toEqual(shape.path);
			expect(focus!.offset).toBeGreaterThanOrEqual(starts[line]);
			expect(focus!.offset).toBeLessThanOrEqual(starts[line + 1] ?? PARA.length);
		};

		test('a click at line 2’s start, ArrowUp: line 1', async ({ page }) => {
			const point = await pointAtRaw(page, shape.path, starts[1], 'after');
			await page.mouse.click(point.x, point.y);
			expect(await focusOf(editor)).toEqual({ path: shape.path, offset: starts[1] });
			await page.keyboard.press('ArrowUp');
			await onLine(0);
		});

		test('Home on line 2, ArrowUp: line 1', async ({ page }) => {
			await lineEdge(editor, shape, starts, 1, 'start');
			await page.keyboard.press('ArrowUp');
			await onLine(0);
		});

		test('End on the second-to-last line, ArrowDown: the last line', async ({ page }) => {
			const last = starts.length - 1;
			await lineEdge(editor, shape, starts, last - 1, 'end');
			await page.keyboard.press('ArrowDown');
			await onLine(last);
		});

		test('Home on the last line, ArrowDown: the block after, at its start', async ({ page }) => {
			await lineEdge(editor, shape, starts, starts.length - 1, 'start');
			await page.keyboard.press('ArrowDown');
			const focus = await focusOf(editor);
			expect(focus?.path).toEqual(shape.after);
			expect(focus!.offset).toBeLessThan(AFTER.length / 2);
		});

		test('End on line 1, ArrowUp: the block before, at its far end', async ({ page }) => {
			await lineEdge(editor, shape, starts, 0, 'end');
			await page.keyboard.press('ArrowUp');
			const focus = await focusOf(editor);
			expect(focus?.path).toEqual(shape.before);
			expect(focus!.offset).toBeGreaterThan(BEFORE.length / 2);
		});

		// Before the space a line wraps at, the caret is on that line only: nothing is asked.
		test('End, ArrowLeft on line 1, ArrowUp: the block before', async ({ page }) => {
			await lineEdge(editor, shape, starts, 0, 'end');
			await page.keyboard.press('ArrowLeft');
			expect(await focusOf(editor)).toEqual({ path: shape.path, offset: starts[1] - 1 });
			await page.keyboard.press('ArrowUp');
			expect((await focusOf(editor))?.path).toEqual(shape.before);
		});

		test('End, ArrowLeft on the second-to-last line, ArrowDown: the last line', async ({
			page
		}) => {
			const last = starts.length - 1;
			await lineEdge(editor, shape, starts, last - 1, 'end');
			await page.keyboard.press('ArrowLeft');
			expect(await focusOf(editor)).toEqual({ path: shape.path, offset: starts[last] - 1 });
			await page.keyboard.press('ArrowDown');
			await onLine(last);
		});
	});
}

test('past the space after a picture opening line 2, ArrowUp: line 1, nothing asked', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await page.addStyleTag({ content: EDITOR_WIDTH });
	const lead = 'alpha beta gamma ';
	await editor.loadContent(`before\n\n${lead}${IMAGE} tail\n\nafter\n`);
	await waitForImagesDecoded(page.locator('.editor img'));
	const line1 = await textRunRect(page, 'alpha', { path: [1] });
	const image = (await page.locator('[data-image-widget]').boundingBox())!;
	expect(image.y, 'the image starts line 2').toBeGreaterThanOrEqual(line1.bottom - 1);
	await editor.focusBlock(1, `${lead}${IMAGE} `.length);
	await page.keyboard.press('ArrowUp');
	const focus = await focusOf(editor);
	expect(focus?.path).toEqual([1]);
	expect(focus!.offset).toBeLessThanOrEqual(lead.length);
});

// ── With Shift ─────────────────────────────────────────────────────────

for (const shape of [...SHAPES, CELL]) {
	test.describe(`Shift at a wrap, in ${shape.name}`, () => {
		let editor: EditorPage;
		let starts: number[];

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto();
			starts = await load(editor, shape);
		});

		test('Home on line 2, Shift+ArrowUp: onto line 1', async ({ page }) => {
			await lineEdge(editor, shape, starts, 1, 'start');
			await page.keyboard.press('Shift+ArrowUp');
			const range = await selectionOf(editor);
			expect(range?.anchor).toEqual({ path: shape.path, offset: starts[1] });
			expect(range?.focus.path).toEqual(shape.path);
			expect(range!.focus.offset).toBeLessThan(starts[1]);
		});

		test('End on the second-to-last line, Shift+ArrowDown: onto the last line', async ({
			page
		}) => {
			const last = starts.length - 1;
			await lineEdge(editor, shape, starts, last - 1, 'end');
			await page.keyboard.press('Shift+ArrowDown');
			const range = await selectionOf(editor);
			expect(range?.anchor).toEqual({ path: shape.path, offset: starts[last] });
			expect(range?.focus.path).toEqual(shape.path);
			expect(range!.focus.offset).toBeGreaterThan(starts[last]);
		});

		// A wrapped cell reads a held range's line by measure, so from a wrap its first Shift+arrow
		// can take a row; these two run in prose only.
		if (shape !== CELL)
			test('a range held back to line 2’s start, Shift+ArrowUp: the anchor stays', async ({
				page
			}) => {
				await editor.focusBlockAtPath(shape.path, starts[1] + 5);
				await page.keyboard.press(`Shift+${edgeKey('lineStart')}`);
				expect((await selectionOf(editor))?.focus).toEqual({ path: shape.path, offset: starts[1] });
				await page.keyboard.press('Shift+ArrowUp');
				const range = await selectionOf(editor);
				expect(range?.anchor).toEqual({ path: shape.path, offset: starts[1] + 5 });
				expect(range?.focus.path).toEqual(shape.path);
				expect(range!.focus.offset).toBeLessThan(starts[1]);
			});

		if (shape !== CELL)
			test('a range held to the second-to-last line’s end, Shift+ArrowDown: the anchor stays', async ({
				page
			}) => {
				const last = starts.length - 1;
				await editor.focusBlockAtPath(shape.path, starts[last - 1] + 5);
				await page.keyboard.press(`Shift+${edgeKey('lineEnd')}`);
				expect((await selectionOf(editor))?.focus).toEqual({
					path: shape.path,
					offset: starts[last]
				});
				await page.keyboard.press('Shift+ArrowDown');
				const range = await selectionOf(editor);
				expect(range?.anchor).toEqual({ path: shape.path, offset: starts[last - 1] + 5 });
				expect(range?.focus.path).toEqual(shape.path);
				expect(range!.focus.offset).toBeGreaterThan(starts[last]);
			});

		// A held range is never asked its line, so the next key starts from the side the browser shows.
		// Up runs from line 3, since a Mac stops a Shift+arrow at the anchor rather than cross it.
		for (const [key, held] of [
			['ArrowUp', 2],
			['ArrowDown', 1]
		] as const) {
			test(`a range held to line ${held + 1}’s start, Shift+${key}: the next line, at the start`, async ({
				page
			}) => {
				await editor.focusBlockAtPath(shape.path, starts[0] + 3);
				for (let i = 0; i < held; i++) await page.keyboard.press('Shift+ArrowDown');
				// Back by characters: on a Mac, Shift+Cmd+ArrowLeft moves a forward range's start instead.
				for (let i = 0; i < 8; i++) {
					if ((await selectionOf(editor))?.focus.offset === starts[held]) break;
					await page.keyboard.press('Shift+ArrowLeft');
				}
				expect((await selectionOf(editor))?.focus).toEqual({
					path: shape.path,
					offset: starts[held]
				});
				await page.keyboard.press(`Shift+${key}`);
				const range = await selectionOf(editor);
				expect(range?.anchor).toEqual({ path: shape.path, offset: starts[0] + 3 });
				expect(range?.focus).toEqual({
					path: shape.path,
					offset: starts[held + (key === 'ArrowUp' ? -1 : 1)]
				});
			});
		}
	});
}

// ── A soft-line delete ─────────────────────────────────────────────────

/** A Mac's Cmd line delete, as `collapsed-delete-class.spec.ts` sends it: the keydown, then the
 *  input it opens unless the keydown was prevented. */
async function sendLineDelete(page: Page, key: 'Backspace' | 'Delete'): Promise<void> {
	await page.evaluate((key) => {
		const keydown = new KeyboardEvent('keydown', {
			key,
			metaKey: true,
			bubbles: true,
			cancelable: true
		});
		(window as any).__lineKeydown = keydown;
		document.activeElement!.dispatchEvent(keydown);
	}, key);
	await page.evaluate((key) => {
		if ((window as any).__lineKeydown.defaultPrevented) return;
		const inputType = key === 'Backspace' ? 'deleteSoftLineBackward' : 'deleteSoftLineForward';
		document.activeElement!.dispatchEvent(
			new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
		);
	}, key);
}

test.describe('a soft-line delete at a wrap', () => {
	let editor: EditorPage;
	let starts: number[];

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		starts = await load(editor, SHAPES[0]);
	});

	test('Home on line 2, Cmd+Backspace: one character, line 1 whole', async ({ page }) => {
		await lineEdge(editor, SHAPES[0], starts, 1, 'start');
		await sendLineDelete(page, 'Backspace');
		await editor.waitForRenderFlush();
		const para = PARA.slice(0, starts[1] - 1) + PARA.slice(starts[1]);
		expect(await editor.bridge.getSource()).toBe(`${BEFORE}\n\n${para}\n\n${AFTER}\n`);
	});

	test('Home on line 2, Cmd+Delete: line 2’s run, line 1 whole', async ({ page }) => {
		await lineEdge(editor, SHAPES[0], starts, 1, 'start');
		await sendLineDelete(page, 'Delete');
		await editor.waitForRenderFlush();
		// Line 2's run, with or without the space it wraps at.
		const kept = [starts[2] - 1, starts[2]].map(
			(end) => `${BEFORE}\n\n${PARA.slice(0, starts[1])}${PARA.slice(end)}\n\n${AFTER}\n`
		);
		expect(kept).toContain(await editor.bridge.getSource());
	});
});
