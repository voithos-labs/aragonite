import { test, expect } from '../../fixtures';
import { PluginsPage, activeBlockPath, capturedErrors, roundTripStable } from './helpers';

/**
 * The bundled party parrot (requirements/plugins/parrot.md), which is the plugin guide's
 * quickstart compiled. Seed `parrot`: block 0 `%%parrot party responsibly`, block 1 `After`.
 * The caption is derived from the block's own raw, so every assertion here is the render side
 * of a byte the source already carries — the bytes themselves are the unit suite's.
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
}

test.describe('the bundled party parrot', () => {
	let editor: ParrotPage;

	test.beforeEach(async ({ page }) => {
		editor = new ParrotPage(page);
		await editor.gotoSeed();
	});

	test('renders the bird and its caption, bytes untouched', async ({ page }) => {
		await expect(editor.frame).toHaveCount(1);
		// Art, not an empty box: the frame carries the bird's own characters.
		await expect(editor.frame).toContainText('kkkk');
		await expect(editor.caption).toHaveText('party responsibly');
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the bird dances on its own', async () => {
		const first = await editor.frame.textContent();
		// The interval is 70ms, so a frame the poll never catches changing is a stopped bird.
		await expect.poll(() => editor.frame.textContent(), { timeout: 3000 }).not.toBe(first);
	});

	test('typing at the end of the source extends the caption live', async ({ page }) => {
		await editor.source.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' tonight');

		await editor.bridge.waitForSourceContains('party responsibly tonight');
		await expect(editor.caption).toHaveText('party responsibly tonight');
		expect(await editor.bridge.getSource()).toBe('%%parrot party responsibly tonight\n\nAfter\n');
		expect(await roundTripStable(page)).toBe(true);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('deleting back to the bare marker drops the caption, bird still dancing', async ({
		page
	}) => {
		await editor.source.click();
		await page.keyboard.press('End');
		for (let i = 0; i < ' party responsibly'.length; i++) {
			await page.keyboard.press('Backspace');
		}

		await editor.bridge.waitForSource((s) => s.startsWith('%%parrot\n'));
		await expect(editor.caption).toHaveCount(0);
		await expect(editor.block).toHaveCount(1);

		const first = await editor.frame.textContent();
		await expect.poll(() => editor.frame.textContent(), { timeout: 3000 }).not.toBe(first);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the caret leaves the leaf into the following paragraph', async ({ page }) => {
		await editor.source.click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		expect(await activeBlockPath(page)).toEqual([1]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
