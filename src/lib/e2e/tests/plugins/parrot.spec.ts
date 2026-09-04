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
		return this.page.locator('pre.parrot');
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

	/** Leave the block downward into `After`; the fold is the blur, so the source unmounts. */
	async leaveDownward(): Promise<void> {
		await this.page.keyboard.press('ArrowDown');
		await expect(this.source).toHaveCount(0);
	}

	async expectDancing(): Promise<void> {
		const first = await this.frame.textContent();
		// The interval is 70ms, so a frame the poll never catches changing is a stopped bird.
		await expect.poll(() => this.frame.textContent(), { timeout: 3000 }).not.toBe(first);
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
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the bird dances on its own', async () => {
		await editor.expectDancing();
	});

	test('a click on the caption reveals the source line, bytes untouched', async ({ page }) => {
		await editor.revealByClick();
		await expect(editor.source).toHaveText('%%parrot party responsibly');
		await expect(editor.caption).toHaveCount(0);
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
					const bird = document.querySelector('pre.parrot') as HTMLElement;
					return {
						editorPan: root.scrollWidth - root.clientWidth,
						birdOverflow: bird.scrollWidth > bird.clientWidth
					};
				})
			)
			.toEqual({ editorPan: 0, birdOverflow: true });
	});
});
