import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';
import { caretsShowing, drawnCaretBox, nativeCaretBox, type CaretBox } from '../../carets-showing';
import { MemoPage } from '../plugins/memo-helpers';
import { clickPastImageRightEdge, waitForFirstImageLoaded } from '../blocks/image/helpers';

// The drawn caret against the browser's own (requirements/caret/drawn-caret.md): exactly one caret
// shows in every row, and where the bar draws, it sits on the browser's caret position.

const ONE_DRAWN = { native: false, drawn: 1 };
const ONE_NATIVE = { native: true, drawn: 0 };
const NONE = { native: false, drawn: 0 };

/** Within a pixel, the rect a user would see as the same caret. */
function expectSameBox(drawn: CaretBox | null, native: CaretBox | null): void {
	expect(drawn, 'the drawn caret draws').not.toBeNull();
	expect(native, 'the browser holds a measurable caret').not.toBeNull();
	expect(
		Math.abs(drawn!.left - native!.left),
		`x ${drawn!.left} vs ${native!.left}`
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(drawn!.top - native!.top),
		`y ${drawn!.top} vs ${native!.top}`
	).toBeLessThanOrEqual(1);
	expect(Math.abs(drawn!.height - native!.height)).toBeLessThanOrEqual(1);
}

/** Exactly one caret shows, and if it is the drawn one, on the browser's caret position. */
async function expectOneCaretOnTheRange(page: Page): Promise<void> {
	await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
	expectSameBox(await drawnCaretBox(page), await nativeCaretBox(page));
}

async function setCaretProp(page: Page, mode: 'auto' | 'native' | 'drawn'): Promise<void> {
	await page.evaluate((m) => (window as any).__test.setCaret(m), mode);
}

test.describe('the drawn caret', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a click in a paragraph draws one caret on the browser’s position', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.clickBlockAtPath([0], 5);
		await expectOneCaretOnTheRange(page);
	});

	test('typing keeps one drawn caret on the browser’s position after every key', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 5);
		for (const letter of 'abcdef') {
			await page.keyboard.type(letter);
			await expectOneCaretOnTheRange(page);
		}
		expect(await editor.bridge.getSource()).toBe('helloabcdef world\n');
	});

	test.describe('sits on the browser’s caret position', () => {
		const ROWS: Array<[string, string, (ep: EditorPage, page: Page) => Promise<void>]> = [
			['at the start of a line', 'hello world\n', (ep) => ep.focusBlock(0, 0)],
			['at the end of a line', 'hello world\n', (ep) => ep.focusBlock(0, 11)],
			[
				'in an empty block',
				'first\n',
				async (ep, page) => {
					await ep.focusBlock(0, 5);
					await page.keyboard.press('Enter');
				}
			],
			['in a heading', '# Title\n', (ep) => ep.focusBlock(0, 4)],
			['in a list item', '- item\n', (ep) => ep.focusBlockAtPath([0, 0, 0], 2)],
			['in a quote', '> quoted\n', (ep) => ep.focusBlockAtPath([0, 0], 3)],
			[
				'in a table cell',
				'| a | b |\n| - | - |\n| cell | d |\n',
				async (ep, page) => {
					await page.locator('.table-cell').nth(2).click();
					await page.keyboard.press('End');
				}
			],
			['in a code block', '```\ncode\n```\n', (ep) => ep.focusBlock(0, 6)],
			[
				'in text right after an inline widget',
				'see :tada: after\n',
				(ep) => ep.focusBlock(0, 'see :tada: a'.length)
			],
			[
				'on the line a Shift+Enter at a block’s end opens',
				'Plan\n',
				async (ep, page) => {
					await ep.focusBlock(0, 4);
					await page.keyboard.press('Shift+Enter');
				}
			]
		];

		for (const [where, md, place] of ROWS) {
			test(where, async ({ page }) => {
				await editor.loadContent(md);
				await place(editor, page);
				await expectOneCaretOnTheRange(page);
			});
		}

		test('in a plugin’s editable leaf', async ({ page }) => {
			const memo = new MemoPage(page);
			await memo.gotoSeed();
			await memo.memo.click();
			await page.keyboard.press('End');
			await expectOneCaretOnTheRange(page);
		});
	});

	test('focus leaving the editor shows no caret, and a click brings the drawn one back', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		await page.evaluate(() => (document.activeElement as HTMLElement).blur());
		await expect.poll(() => caretsShowing(page)).toEqual(NONE);
		await editor.clickBlockAtPath([0], 3);
		await expectOneCaretOnTheRange(page);
	});

	test('the window losing focus shows no caret, and regaining it shows the drawn one', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		// A headless page keeps its window focused, so the focus read and its events are stood in.
		await page.evaluate(() => {
			document.hasFocus = () => false;
			window.dispatchEvent(new FocusEvent('blur'));
		});
		await expect.poll(() => drawnCaretBox(page)).toBeNull();
		await page.evaluate(() => {
			document.hasFocus = () => true;
			window.dispatchEvent(new FocusEvent('focus'));
		});
		await expectOneCaretOnTheRange(page);
	});

	test('a range in one block shows no caret, and collapsing it shows the drawn one', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 5);
		await page.keyboard.press('Shift+ArrowLeft');
		await expect.poll(() => caretsShowing(page)).toEqual(NONE);
		await page.keyboard.press('ArrowRight');
		await expectOneCaretOnTheRange(page);
	});

	test('a cross-block range shows no caret', async ({ page }) => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await expect.poll(() => caretsShowing(page)).toEqual(NONE);
	});

	test('beside an image the snap caret is the one caret', async ({ page }) => {
		await editor.loadContent('- ![pic|300x200](/test-fixtures/sample.png)\n');
		await waitForFirstImageLoaded(page);
		await clickPastImageRightEdge(page);
		await expect(page.locator('[data-image-widget].md-snap-after')).toHaveCount(1);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		expect(await drawnCaretBox(page), 'the bar steps aside for the snap caret').toBeNull();
	});

	test('the find bar keeps the browser’s caret', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await page.keyboard.press('ControlOrMeta+f');
		await page.keyboard.type('wor');
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
	});

	test('an IME composition shows the browser’s caret, and the commit the drawn one', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 5);
		const ime = await attachIme(page);
		await ime.compose('か');
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
		await ime.commit('かん');
		await editor.bridge.waitForSourceContains('helloかん world');
		await expectOneCaretOnTheRange(page);
	});

	test('reduced motion draws a caret that doesn’t blink', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		const animation = await page
			.locator('.md-drawn-caret')
			.evaluate((bar) => getComputedStyle(bar).animationName);
		expect(animation).toBe('none');
	});

	test('forced colors keep the browser’s caret', async ({ page }) => {
		await page.emulateMedia({ forcedColors: 'active' });
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await page.keyboard.type('x');
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
	});

	test('the caret prop: native never draws, drawn draws, and a live switch swaps in place', async ({
		page
	}) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		await setCaretProp(page, 'native');
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
		await page.keyboard.type('x');
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
		await setCaretProp(page, 'drawn');
		await expectOneCaretOnTheRange(page);
	});

	test('the bar is hidden from assistive tech and leaves the selection alone', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await editor.focusBlock(0, 3);
		await expect.poll(() => caretsShowing(page)).toEqual(ONE_DRAWN);
		const bar = page.locator('.md-drawn-caret');
		await expect(bar).toHaveAttribute('aria-hidden', 'true');
		const snapshot = await page.locator('.editor').ariaSnapshot();
		expect(snapshot).not.toContain('md-drawn-caret');
		const read = await page.evaluate(() => {
			const sel = window.getSelection()!;
			return {
				active: document.activeElement?.className,
				node: sel.anchorNode?.textContent,
				offset: sel.anchorOffset,
				inBar: !!(sel.anchorNode as Element | null)?.parentElement?.closest('.md-drawn-caret')
			};
		});
		expect(read).toEqual({
			active: expect.stringContaining('text-editable-block'),
			node: 'hello world',
			offset: 3,
			inBar: false
		});
	});

	test.describe('on a coarse pointer', () => {
		test.use({ hasTouch: true });

		test('keeps the browser’s caret', async ({ page }) => {
			await editor.loadContent('hello world\n');
			await editor.focusBlock(0, 3);
			await expect.poll(() => caretsShowing(page)).toEqual(ONE_NATIVE);
		});
	});
});

// ── Soft wraps, against the browser's own painted caret ────────────────────

interface PaintedCaret {
	left: number;
	top: number;
	bottom: number;
}

/** The column and the span of the red caret the browser paints in `clip`, or null while it blinks
 *  off. */
async function paintedRedCaret(
	page: Page,
	clip: { x: number; y: number; width: number; height: number }
): Promise<PaintedCaret | null> {
	const shot = await page.screenshot({ clip, caret: 'initial' });
	return page.evaluate(
		async ({ b64, clip }) => {
			const img = new Image();
			img.src = `data:image/png;base64,${b64}`;
			await img.decode();
			const canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(img, 0, 0);
			const { data } = ctx.getImageData(0, 0, img.width, img.height);
			let left = Infinity;
			let top = Infinity;
			let bottom = -Infinity;
			for (let y = 0; y < img.height; y++) {
				for (let x = 0; x < img.width; x++) {
					const i = (y * img.width + x) * 4;
					if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) {
						left = Math.min(left, x);
						top = Math.min(top, y);
						bottom = Math.max(bottom, y + 1);
					}
				}
			}
			if (left === Infinity) return null;
			return { left: clip.x + left, top: clip.y + top, bottom: clip.y + bottom };
		},
		{ b64: shot.toString('base64'), clip }
	);
}

/** Where the browser paints its own caret now, red and found by eye, retried past a blink. */
async function browserCaret(page: Page): Promise<PaintedCaret> {
	await setCaretProp(page, 'native');
	await page.addStyleTag({
		content: '.editor [contenteditable] { caret-color: rgb(255, 0, 0) !important; }'
	});
	const block = (await page.locator('.text-editable-block').first().boundingBox())!;
	const clip = { x: block.x - 4, y: block.y - 4, width: block.width + 8, height: block.height + 8 };
	let found: PaintedCaret | null = null;
	await expect
		.poll(async () => (found = await paintedRedCaret(page, clip)), { timeout: 5000 })
		.not.toBeNull();
	return found!;
}

test.describe('the drawn caret at a soft wrap', () => {
	let editor: EditorPage;
	const LONG = 'wrap '.repeat(60).trim();

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(`${LONG}\n`);
	});

	/** Exactly one caret shows; a drawn one sits on the line, and at the x, the browser paints its
	 *  own caret at for the same selection. */
	async function oneCaretOnTheBrowsersLine(page: Page): Promise<'drawn' | 'native'> {
		// A key the browser handles moves the caret in a later task; its paint lands by the frame.
		await page.evaluate(
			() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
		);
		await expect
			.poll(async () => {
				const showing = await caretsShowing(page);
				return showing.drawn + (showing.native ? 1 : 0);
			})
			.toBe(1);
		const drawn = await drawnCaretBox(page);
		if (!drawn) return 'native';
		const painted = await browserCaret(page);
		// The same line: WebKit paints its own caret the full line box tall past a wrap, taller than
		// the text, so the drawn bar's middle is what has to fall inside it.
		const middle = drawn.top + drawn.height / 2;
		expect(middle, `line ${drawn.top} vs ${painted.top}..${painted.bottom}`).toBeGreaterThan(
			painted.top
		);
		expect(middle).toBeLessThan(painted.bottom);
		expect(
			Math.abs(drawn.left - painted.left),
			`x ${drawn.left} vs ${painted.left}`
		).toBeLessThanOrEqual(1);
		return 'drawn';
	}

	test('End on a wrapped line: the browser’s own caret, at the wrap', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
	});

	test('Home on the second visual line: the browser’s own caret, at the wrap', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Home');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
	});

	test('ArrowRight across a wrap: the drawn caret, on the browser’s line', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});

	test('typing at a wrap: one caret, on the browser’s line', async ({ page }) => {
		await editor.focusBlock(0, 0);
		await page.keyboard.press('End');
		await page.keyboard.type('x');
		await oneCaretOnTheBrowsersLine(page);
	});
});
