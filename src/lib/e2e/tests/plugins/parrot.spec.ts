import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath, capturedErrors, roundTripStable } from './helpers';

/**
 * The bundled party parrot (requirements/plugins/parrot.md), which is the plugin guide's
 * quickstart compiled: a render-primary leaf whose caption is the folded view and whose source
 * line exists only while the caret is in the block. Seed `parrot`: block 0
 * `%%parrot party responsibly`, block 1 `After`. The bytes themselves are the unit suite's.
 */

const SEED = '%%parrot party responsibly\n\nAfter\n';

class ParrotPage extends PluginsPage {
	get block() {
		return this.page.locator('.parrot-block');
	}
	get frame() {
		return this.page.locator('.parrot');
	}
	get caption() {
		return this.page.locator('.parrot-caption');
	}
	get source() {
		return this.page.locator('.parrot-source');
	}

	async gotoSeed(): Promise<void> {
		await this.gotoPlugins('parrot');
		await expect(this.block).toHaveCount(1);
	}

	/** Click the caption and settle on the source line's arrival, caret inside it. */
	async revealByClick(): Promise<void> {
		await this.caption.click();
		await expect(this.source).toHaveCount(1);
		await expect(this.source).toBeFocused();
	}

	/** The rendered caption's TEXT box, not the div's: the div spans the block width, so a
	 *  fraction of it lands past the last glyph. */
	async captionTextBox(): Promise<{ x: number; y: number; width: number; height: number }> {
		return this.page.evaluate(() => {
			const range = document.createRange();
			range.selectNodeContents(document.querySelector('.parrot-caption')!);
			const { x, y, width, height } = range.getBoundingClientRect();
			return { x, y, width, height };
		});
	}

	/** Collapsed caret offset within the revealed source's single text node, or null. */
	async sourceCaretOffset(): Promise<number | null> {
		return this.page.evaluate(() => {
			const el = document.querySelector('.parrot-source');
			const selection = window.getSelection();
			if (!el || !selection || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			return el.contains(range.startContainer) ? range.startOffset : null;
		});
	}

	/** Press that far across the caption's text and report where the reveal put the caret. */
	async revealByClickAcross(fraction: number): Promise<number | null> {
		const box = await this.captionTextBox();
		await this.page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
		await expect(this.source).toBeFocused();
		return this.sourceCaretOffset();
	}

	/** Leave the block downward into `After`; the fold is the blur, so the source unmounts. */
	async leaveDownward(): Promise<void> {
		await this.page.keyboard.press('ArrowDown');
		await expect(this.source).toHaveCount(0);
	}

	/** What the dance actually moves: the reel's own transform, read the way a viewer sees it. */
	reelTransform(): Promise<string> {
		return this.page.evaluate(
			() => getComputedStyle(document.querySelector('.parrot-reel')!).transform
		);
	}

	/** How many clip windows tall the strip is. A step lands on the next frame rather than
	 *  halfway into it only while this is the frame count exactly. */
	reelFrameFit(): Promise<number> {
		return this.page.evaluate(() => {
			const windowHeight = document.querySelector('.parrot')!.getBoundingClientRect().height;
			const stripHeight = document.querySelector('.parrot-reel')!.getBoundingClientRect().height;
			return Math.round((stripHeight / windowHeight) * 100) / 100;
		});
	}

	async expectDancing(): Promise<void> {
		const first = await this.reelTransform();
		// A frame is 70ms, so a reel the poll never catches moving is a stopped bird.
		await expect.poll(() => this.reelTransform(), { timeout: 3000 }).not.toBe(first);
	}
}

test.describe('the bundled party parrot', () => {
	let editor: ParrotPage;

	test.beforeEach(async ({ page }) => {
		editor = new ParrotPage(page);
		await editor.gotoSeed();
	});

	test('renders the bird and its caption at rest, the source folded', async ({ page }) => {
		await expect(editor.frame).toHaveCount(1);
		// Art, not an empty box: the frame carries the bird's own characters.
		await expect(editor.frame).toContainText('kkkk');
		await expect(editor.caption).toHaveText('party responsibly');
		await expect(editor.source).toHaveCount(0);
		// One frame on screen, the canonical ten in the strip behind it.
		expect(await editor.reelFrameFit()).toBe(10);
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the bird dances on its own', async () => {
		await editor.expectDancing();
	});

	test('the dance moves no byte of the block', async ({ page }) => {
		const before = await editor.block.textContent();
		// Six frame periods: a bird repainted from script has swapped several times by now.
		await page.waitForTimeout(420);

		expect(await editor.block.textContent()).toBe(before);
		await editor.expectDancing();
	});

	test('a click on the caption reveals the source line, bytes untouched', async ({ page }) => {
		await editor.revealByClick();
		await expect(editor.source).toHaveText('%%parrot party responsibly');
		await expect(editor.caption).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a press in the caption reveals at the character pressed, not at the line start', async ({
		page
	}) => {
		const early = await editor.revealByClickAcross(0.25);
		await editor.leaveDownward();
		const late = await editor.revealByClickAcross(0.75);

		// Ordered rather than byte-exact: a rect-derived x lands on whichever side of a glyph the
		// font metrics put it. Both past the marker, and the righter press further along — which a
		// landing that ignores the point cannot satisfy, since that one is 0 every time.
		expect(early).toBeGreaterThan('%%parrot '.length);
		expect(late!).toBeGreaterThan(early!);
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a press on the bird reveals the source too', async ({ page }) => {
		const box = (await editor.frame.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

		await expect(editor.source).toHaveCount(1);
		await expect(editor.source).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('typing then leaving folds the block and the caption shows the new text', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.type(' tonight');
		// Ephemeral until the caret leaves: nothing has reached the document yet.
		expect(await editor.bridge.getSource()).toBe(SEED);

		await editor.leaveDownward();
		await editor.bridge.waitForSourceEquals('%%parrot party responsibly tonight\n\nAfter\n');
		await expect(editor.caption).toHaveText('party responsibly tonight');
		expect(await activeBlockPath(page)).toEqual([1]);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('undo after the reveal, edit, leave cycle restores the old bytes in one step', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		// Two bursts across the batch window: per-keystroke commits would take two undos.
		await page.keyboard.type(' to');
		await editor.waitForUndoBatchFlush();
		await page.keyboard.type('night');
		await editor.leaveDownward();
		await editor.bridge.waitForSourceContains('tonight');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(SEED);
		await expect(editor.caption).toHaveText('party responsibly');
		await expect(editor.source).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('deleting back to the bare marker then leaving drops the caption, bird still dancing', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		for (let i = 0; i < ' party responsibly'.length; i++) {
			await page.keyboard.press('Backspace');
		}
		await editor.leaveDownward();

		await editor.bridge.waitForSourceEquals('%%parrot\n\nAfter\n');
		await expect(editor.caption).toHaveText('');
		await expect(editor.block).toHaveCount(1);
		await editor.expectDancing();
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the caret walks in from the following paragraph and back out', async ({ page }) => {
		await editor.getBlock(1).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(editor.source).toHaveCount(1);
		expect(await activeBlockPath(page)).toEqual([0]);

		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.source).toHaveCount(0);
		expect(await activeBlockPath(page)).toEqual([1]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Enter at the end of the caption leaves a paragraph below, caret in it', async ({
		page
	}) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		// The shape a heading's Enter writes at the same offset, byte for byte.
		await editor.bridge.waitForSourceEquals('%%parrot party responsibly\n\n\nAfter\n');
		await expect(editor.source).toHaveCount(0);
		await expect(editor.caption).toHaveText('party responsibly');
		expect(await activeBlockPath(page)).toEqual([1]);
		expect(await roundTripStable(page)).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Enter after a bare marker commits the emptied caption, then splits', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('End');
		for (let i = 0; i < ' party responsibly'.length; i++) {
			await page.keyboard.press('Backspace');
		}
		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceEquals('%%parrot\n\n\nAfter\n');
		await expect(editor.caption).toHaveText('');
		expect(await activeBlockPath(page)).toEqual([1]);
		await editor.expectDancing();

		// One step, not two: the fold's commit is still inside its undo batch when the split
		// lands on the same press, so the pair shares an entry.
		await editor.undo();
		await editor.bridge.waitForSourceEquals(SEED);
		await expect(editor.caption).toHaveText('party responsibly');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Enter mid-caption moves the tail into the paragraph below', async ({ page }) => {
		await editor.revealByClick();
		await page.keyboard.press('Home');
		// Walked, not clicked: a rect-derived point lands on whichever side of a glyph the font
		// metrics put it, and the assertion below is byte-exact.
		for (let i = 0; i < '%%parrot party'.length; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceEquals('%%parrot party\n responsibly\n\nAfter\n');
		await expect(editor.caption).toHaveText('party');
		expect(await activeBlockPath(page)).toEqual([1]);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('typing the marker into a paragraph then pressing Enter lands a paragraph below', async ({
		page
	}) => {
		await editor.getBlock(1).click();
		await page.keyboard.press('End');
		for (let i = 0; i < 'After'.length; i++) {
			await page.keyboard.press('Backspace');
		}
		await page.keyboard.type('%%parrot');
		// The kind flip mounts the bird with its source revealed and the caret still at the end.
		await expect(editor.block).toHaveCount(2);
		await expect(editor.source).toHaveCount(1);

		await page.keyboard.press('Enter');

		await editor.bridge.waitForSourceEquals('%%parrot party responsibly\n\n%%parrot\n\n\n');
		await expect(editor.source).toHaveCount(0);
		expect(await activeBlockPath(page)).toEqual([2]);
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('reading mode shows the rendered view only, and a click reveals nothing', async ({
		page
	}) => {
		await editor.setPresentationMode('reading');
		await expect(editor.caption).toHaveText('party responsibly');
		await expect(editor.source).toHaveCount(0);

		await editor.caption.click();
		await expect(editor.caption).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

test.describe('the bird under reduced motion', () => {
	test.use({ contextOptions: { reducedMotion: 'reduce' } });

	test('rests on one frame instead of dancing', async ({ page }) => {
		const editor = new ParrotPage(page);
		await editor.gotoSeed();

		const first = await editor.reelTransform();
		await page.waitForTimeout(420);
		expect(await editor.reelTransform()).toBe(first);
		// Parked at the strip's top, so the bird on screen is a whole frame rather than none.
		expect(first === 'none' || first === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
	});
});

test.describe('the bird at phone width', () => {
	test.use({ viewport: { width: 320, height: 640 } });

	test('scrolls inside its own box instead of panning the document', async ({ page }) => {
		const editor = new ParrotPage(page);
		await editor.gotoSeed();

		// Every frame is wider than a phone column, so the bird overflowing its own box is
		// the premise; the editor staying unpanned is the claim.
		await expect
			.poll(() =>
				page.evaluate(() => {
					const root = document.querySelector('.editor') as HTMLElement;
					const bird = document.querySelector('.parrot') as HTMLElement;
					return {
						editorPan: root.scrollWidth - root.clientWidth,
						birdOverflow: bird.scrollWidth > bird.clientWidth
					};
				})
			)
			.toEqual({ editorPan: 0, birdOverflow: true });
	});
});
