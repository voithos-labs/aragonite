import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * Command-mint dogfood driver: the `:::note` callout mints `callout.setKind` and binds it to two
 * arg-bearing chords (Mod+7→'note', Mod+8→'warning'). Each test drives a REAL keypress on an inner
 * leaf and proves the bubble-dispatch chain end to end — keypress → eventToChord → leaf declines →
 * container handleKeydown → keymap → registered handler → metadata commit → rebuildCalloutRaw.
 * Chord choice: a Shift-held digit's key token is browser-translated ('1'→'!'), so Mod+Shift+1/2
 * would be dead keys under real keyboard simulation; see callout-kind.ts.
 */

const NOTE_DOC = ':::note\nbody\n:::\n';
const WARNING_DOC = ':::warning\nbody\n:::\n';

test.describe('callout.setKind — mint → keymap → bubble dispatch → metadata commit', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('Mod+8 from the body sets calloutType to warning and round-trips', async ({ page }) => {
		await editor.loadContent(NOTE_DOC);
		await editor.focusBlockAtPath([0, 1], 0); // callout body paragraph
		await page.keyboard.press(`${primaryModifier}+8`);

		await editor.bridge.waitForSourceContains(':::warning');
		expect((await editor.bridge.getSource()).trim()).toBe(':::warning\nbody\n:::');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the type-change fires exactly one metadataUpdate edit op', async ({ page }) => {
		await editor.loadContent(NOTE_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.keyboard.press(`${primaryModifier}+8`);
		await editor.bridge.waitForSourceContains(':::warning');
		const ops = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toEqual(['metadataUpdate']);
	});

	test('Ctrl+Z restores the prior type', async ({ page }) => {
		await editor.loadContent(NOTE_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press(`${primaryModifier}+8`);
		await editor.bridge.waitForSourceContains(':::warning');

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::note');
		expect((await editor.bridge.getSource()).trim()).toBe(':::note\nbody\n:::');
	});

	test('the chord fires from the reserved title chrome too, not just the body', async ({
		page
	}) => {
		await editor.loadContent(NOTE_DOC);
		await editor.focusBlockAtPath([0, 0], 0); // note-title chrome leaf (child 0)
		await page.keyboard.press(`${primaryModifier}+8`);

		await editor.bridge.waitForSourceContains(':::warning');
		expect((await editor.bridge.getSource()).trim()).toBe(':::warning\nbody\n:::');
	});

	test('the note-arg binding (Mod+7) carries its own string arg through the descriptor', async ({
		page
	}) => {
		await editor.loadContent(WARNING_DOC);
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press(`${primaryModifier}+7`);

		await editor.bridge.waitForSourceContains(':::note');
		expect((await editor.bridge.getSource()).trim()).toBe(':::note\nbody\n:::');
	});
});
