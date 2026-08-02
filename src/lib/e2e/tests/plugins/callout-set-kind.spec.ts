import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * Command-mint dogfood driver: the `:::callout` callout mints `callout.setKind` and binds it to two
 * arg-bearing chords (Mod+7→'callout', Mod+8→'aside'). Each test drives a REAL keypress on an inner
 * leaf and proves the bubble-dispatch chain end to end — keypress → eventToChord → leaf declines →
 * container handleKeydown → keymap → registered handler → metadata commit → rebuildCalloutRaw.
 * Chord choice: a Shift-held digit's key token is browser-translated ('1'→'!'), so Mod+Shift+1/2
 * would be dead keys under real keyboard simulation; see callout-kind.ts.
 */

const CALLOUT_DOC = ':::callout\nbody\n:::\n';
const WARNING_DOC = ':::aside\nbody\n:::\n';

test.describe('callout.setKind — mint → keymap → bubble dispatch → metadata commit', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('Mod+8 from the body sets calloutType to aside and round-trips', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0); // callout body paragraph
		await page.keyboard.press(`${primaryModifier}+8`);

		await editor.bridge.waitForSourceContains(':::aside');
		expect((await editor.bridge.getSource()).trim()).toBe(':::aside\nbody\n:::');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the type-change fires exactly one metadataUpdate edit op', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.keyboard.press(`${primaryModifier}+8`);
		await editor.bridge.waitForSourceContains(':::aside');
		const ops = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toEqual(['metadataUpdate']);
	});

	test('Ctrl+Z restores the prior type', async ({ page }) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press(`${primaryModifier}+8`);
		await editor.bridge.waitForSourceContains(':::aside');

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::callout');
		expect((await editor.bridge.getSource()).trim()).toBe(':::callout\nbody\n:::');
	});

	test('the chord fires from the reserved title chrome too, not just the body', async ({
		page
	}) => {
		await editor.loadContent(CALLOUT_DOC);
		await editor.focusBlockAtPath([0, 0], 0); // callout-title chrome leaf (child 0)
		await page.keyboard.press(`${primaryModifier}+8`);

		await editor.bridge.waitForSourceContains(':::aside');
		expect((await editor.bridge.getSource()).trim()).toBe(':::aside\nbody\n:::');
	});

	test('the callout-arg binding (Mod+7) carries its own string arg through the descriptor', async ({
		page
	}) => {
		await editor.loadContent(WARNING_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press(`${primaryModifier}+7`);

		await editor.bridge.waitForSourceContains(':::callout');
		expect((await editor.bridge.getSource()).trim()).toBe(':::callout\nbody\n:::');
	});
});
