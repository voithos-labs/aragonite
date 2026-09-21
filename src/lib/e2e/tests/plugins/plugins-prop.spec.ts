import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, readDoc, roundTripStable } from './helpers';

// The `/test/plugins` harness installs its four dogfood plugins through the `<Editor plugins>`
// prop. These tests pin the prop itself, and that it runs before the seed parses, reading the CST
// by path through `window.__test`. Each plugin's editing and rendering lives in its own spec, and
// installing twice in one process is covered by the unit suite, so reloading the page is the only
// repeat here.

test.describe('plugins prop: install before the first parse', () => {
	let editor: PluginsPage;

	test.beforeEach(({ page }) => {
		editor = new PluginsPage(page);
	});

	test('installs the first listed plugin before the seed parses', async ({ page }) => {
		await editor.gotoPlugins(); // default callout seed

		const callout = await readContainer(page, 0);
		expect(callout.kind).toBe('callout');
		expect(callout.childKinds[0]).toBe('callout-title');
		// Installing too late shows as one of two fallbacks: with the grammar off the block is a
		// `paragraph`, and with the grammar on but callout unregistered a `directiveContainer`.
		expect(callout.kind).not.toBe('paragraph');
		expect(callout.kind).not.toBe('directiveContainer');
	});

	test('installs every listed plugin, not just the first', async ({ page }) => {
		await editor.gotoPlugins('admonitions');

		// admonitions sits last in the prop's array, so a fallback here would mean installing
		// stopped after the first entry.
		expect((await readDoc(page)).kinds).toContain('admonition');
	});

	test('re-runs the prop cleanly on a fresh load', async ({ page }) => {
		await editor.gotoPlugins();
		expect((await readContainer(page, 0)).kind).toBe('callout');

		await editor.gotoPlugins(); // fresh process, prop re-installs
		expect((await readContainer(page, 0)).kind).toBe('callout');
		expect(await roundTripStable(page)).toBe(true);
	});
});
