import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { PluginsPage, readDoc, roundTripStable } from './helpers';

/**
 * The admonitions dogfood registers a content-keyed pre-parse paste transform, so
 * a pasted GitHub-alert blockquote converts to a `:::name` admonition before it
 * parses. On `/test/plugins` the callout dogfood owns `note`/`warning`, so an
 * admonition-owned alert type (`tip`) is pasted to assert the admonition kind.
 * Real clipboard write + `Mod+V`; the CST is read by path via `window.__test`.
 * The convert-button path (loaded documents) is covered by admonitions.spec.
 */

test.describe('plugin admonitions — paste transform', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
		await expect(page.locator('.admonition')).toHaveCount(3);
	});

	test('pasting a GitHub alert converts it to an admonition, undoable in one step', async ({
		page
	}) => {
		await editor.loadContent('Intro paragraph.\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await page.evaluate(() => navigator.clipboard.writeText('> [!TIP]\n> Handy note.\n'));
		await page.keyboard.press(`${primaryModifier}+v`);

		// The transform rewrote the blockquote alert to a :::tip directive pre-parse.
		await editor.bridge.waitForSourceContains(':::tip');
		expect((await readDoc(page)).kinds).toContain('admonition');
		expect(await roundTripStable(page)).toBe(true);

		// One undo restores the pre-paste document byte-for-byte — the transform did
		// not fracture the single paste commit.
		await editor.undo();
		await editor.bridge.waitForSourceWith((source, prior) => source === prior, before);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a top-level alert converts while an alert inside a code fence stays literal (fence-safe)', async ({
		page
	}) => {
		await editor.loadContent('Intro paragraph.\n');
		await editor.focusBlockEnd(0);
		// One paste carrying both a top-level alert and a fenced alert: the transform
		// must convert the first and spare the second (parse-scoped, not a line scan).
		await page.evaluate(() =>
			navigator.clipboard.writeText(
				'> [!TIP]\n> Top-level alert.\n\n```md\n> [!NOTE]\n> Inside a fence.\n```\n'
			)
		);
		await page.keyboard.press(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains(':::tip');
		const source = await editor.bridge.getSource();
		// The fenced alert was left byte-identical — never rewritten to :::note.
		expect(source).toContain('```md');
		expect(source).toContain('> [!NOTE]');
		expect(source).not.toContain(':::note');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('admonition');
		expect(kinds).toContain('fencedCode');
	});

	// The whole-table-selection paste route (Ctrl+A 2nd press inside a cell)
	// bypasses pasteDispatch entirely, so it carries its own applyPasteTransforms
	// call — this pins that sibling site, which every other paste test misses.
	test('whole-table-selection paste runs the transform: the table becomes an admonition', async ({
		page
	}) => {
		await editor.loadContent('before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press(`${primaryModifier}+a`);
		await page.keyboard.press(`${primaryModifier}+a`);
		await editor.waitForCrossBlock(true);

		await page.evaluate(() => navigator.clipboard.writeText('> [!TIP]\n> Replaced table.\n'));
		await page.keyboard.press(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains(':::tip');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('admonition');
		expect(kinds).not.toContain('table');
		expect(await roundTripStable(page)).toBe(true);
	});
});
