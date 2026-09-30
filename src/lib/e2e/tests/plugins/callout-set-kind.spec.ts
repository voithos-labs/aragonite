import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * A plugin registering its own command: `:::callout` registers `callout.setKind` and binds it to
 * Mod+7 ('callout') and Mod+8 ('aside'). Each test presses a real key on an inner block and follows
 * the chain from keypress through the container's keymap to the metadata commit and raw rebuild.
 * Shift-held digits are avoided because the browser turns '1' into '!'.
 */

const CALLOUT_DOC = ':::callout\nbody\n:::\n';
const WARNING_DOC = ':::aside\nbody\n:::\n';

test.describe('callout.setKind: create → keymap → bubble dispatch → metadata commit', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('Mod+8 from the body sets calloutType to aside and round-trips', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0); // callout body paragraph
		await page.keyboard.press('ControlOrMeta+8');

		await editor.bridge.waitForSourceContains(':::aside');
		expect((await editor.bridge.getSource()).trim()).toBe(':::aside\nbody\n:::');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the type-change fires exactly one metadataUpdate edit op', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.keyboard.press('ControlOrMeta+8');
		await editor.bridge.waitForSourceContains(':::aside');
		const ops = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toEqual(['metadataUpdate']);
	});

	test('Ctrl+Z restores the prior type', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press('ControlOrMeta+8');
		await editor.bridge.waitForSourceContains(':::aside');

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::callout');
		expect((await editor.bridge.getSource()).trim()).toBe(':::callout\nbody\n:::');
	});

	test('the chord fires from the reserved title chrome too, not just the body', async ({
		page
	}) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 0], 0); // the callout's title row, child 0
		await page.keyboard.press('ControlOrMeta+8');

		await editor.bridge.waitForSourceContains(':::aside');
		expect((await editor.bridge.getSource()).trim()).toBe(':::aside\nbody\n:::');
	});

	test('the callout-arg binding (Mod+7) carries its own string arg through the descriptor', async ({
		page
	}) => {
		await editor.loadContent(WARNING_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press('ControlOrMeta+7');

		await editor.bridge.waitForSourceContains(':::callout');
		expect((await editor.bridge.getSource()).trim()).toBe(':::callout\nbody\n:::');
	});
});
