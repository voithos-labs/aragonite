import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, readDoc, roundTripStable } from './helpers';

// The `/test/plugins` harness installs its four dogfood plugins through the
// `<Editor plugins>` prop. These gates pin the prop pathway itself — that it runs
// before the seed parses — reading the CST by path via `window.__test`. Per-plugin
// editing/rendering lives in the sibling specs; repeat-install-in-one-process is
// unit-pinned, so the reload path is the only repeat this e2e covers.

test.describe('plugins prop: install before the first parse', () => {
	let editor: PluginsPage;

	test.beforeEach(({ page }) => {
		editor = new PluginsPage(page);
	});

	test('installs the first listed plugin before the seed parses', async ({ page }) => {
		await editor.gotoPlugins(); // default callout seed

		const callout = await readContainer(page, 0);
		expect(callout.kind).toBe('note');
		expect(callout.childKinds[0]).toBe('note-title');
		// A too-late install shows as one of two fallbacks: grammar off → `paragraph`;
		// grammar on but callout unregistered → generic `directiveContainer`.
		expect(callout.kind).not.toBe('paragraph');
		expect(callout.kind).not.toBe('directiveContainer');
	});

	test('installs every listed plugin, not just the first', async ({ page }) => {
		await editor.gotoPlugins('admonitions');

		// admonitions sits last in the prop array; a fallback here would mean the prop
		// stopped installing after the first entry.
		expect((await readDoc(page)).kinds).toContain('admonition');
	});

	test('re-runs the prop cleanly on a fresh load', async ({ page }) => {
		await editor.gotoPlugins();
		expect((await readContainer(page, 0)).kind).toBe('note');

		await editor.gotoPlugins(); // fresh process, prop re-installs
		expect((await readContainer(page, 0)).kind).toBe('note');
		expect(await roundTripStable(page)).toBe(true);
	});
});
