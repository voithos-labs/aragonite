import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { PluginsPage, readDoc, roundTripStable } from './helpers';

/**
 * Native GitHub alerts on paste. With rendering shipped, the admonitions plugin's paste transform
 * is opt-in (default off), so a pasted `> [!TYPE]` blockquote keeps its GitHub bytes and lands as a
 * native `githubAlert`, never rewritten to `:::name`. The opt-in rewrite is unit-covered
 * (github-alert-paste-opt-in).
 */

test.describe('plugin admonitions — native alert paste', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
		await expect(page.locator(".admonition[data-alert-source='github']")).toHaveCount(1);
	});

	test('pasting a GitHub alert lands a native githubAlert, bytes intact, undoable in one step', async ({
		page
	}) => {
		await editor.loadContent('Intro paragraph.\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlockEnd(0);
		await editor.seedClipboard('> [!TIP]\n> Handy note.\n');
		await editor.paste(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains('> [!TIP]');
		expect((await readDoc(page)).kinds).toContain('githubAlert');
		expect(await editor.bridge.getSource()).not.toContain(':::tip');
		expect(await roundTripStable(page)).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceWith((source, prior) => source === prior, before);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a fenced alert in the same paste stays literal alongside the native top-level one', async ({
		page
	}) => {
		await editor.loadContent('Intro paragraph.\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard(
			'> [!TIP]\n> Top-level alert.\n\n```md\n> [!NOTE]\n> Inside a fence.\n```\n'
		);
		await editor.paste(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains('> [!TIP]');
		const source = await editor.bridge.getSource();
		expect(source).toContain('```md');
		expect(source).toContain('> [!NOTE]');
		expect(source).not.toContain(':::');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('githubAlert');
		expect(kinds).toContain('fencedCode');
	});

	// The whole-table-selection paste route bypasses the shared paste dispatch and carries its own
	// parse of the pasted text, so this pins that sibling route lands the alert natively too (the
	// applyPasteTransforms parity itself is source-scan-pinned by G4.11).
	test('whole-table-selection paste replaces the table with a native alert', async ({ page }) => {
		await editor.loadContent('before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n');
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press(`${primaryModifier}+a`);
		await page.keyboard.press(`${primaryModifier}+a`);
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('> [!TIP]\n> Replaced table.\n');
		await editor.paste(`${primaryModifier}+v`);

		await editor.bridge.waitForSourceContains('> [!TIP]');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('githubAlert');
		expect(kinds).not.toContain('table');
		expect(await roundTripStable(page)).toBe(true);
	});
});
