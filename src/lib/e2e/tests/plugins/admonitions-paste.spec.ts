import { test, expect } from '../../fixtures';
import { PluginsPage, readDoc, roundTripStable } from './helpers';

/**
 * Native GitHub alerts on paste. The admonitions plugin's paste rewrite is opt-in, so a pasted
 * `> [!TYPE]` blockquote keeps its GitHub bytes and lands as a native `githubAlert`, never
 * `:::name`. The opt-in rewrite is unit-covered (`github-alert-paste-opt-in`).
 */

test.describe('plugin admonitions: native alert paste', () => {
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
		await editor.paste();

		await editor.bridge.waitForSourceContains('> [!TIP]');
		expect((await readDoc(page)).kinds).toContain('admonitions/alert');
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
		await editor.paste();

		await editor.bridge.waitForSourceContains('> [!TIP]');
		const source = await editor.bridge.getSource();
		expect(source).toContain('```md');
		expect(source).toContain('> [!NOTE]');
		expect(source).not.toContain(':::');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('admonitions/alert');
		expect(kinds).toContain('fencedCode');
	});

	// Pasting over a whole selected table parses the text itself, outside the shared paste dispatch,
	// so this checks it lands the alert natively too (G4.11 holds both to `rewrittenPaste`).
	test('whole-table-selection paste replaces the table with a native alert', async ({ page }) => {
		await editor.loadContent('before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n');
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		await editor.seedClipboard('> [!TIP]\n> Replaced table.\n');
		await editor.paste();

		await editor.bridge.waitForSourceContains('> [!TIP]');
		await editor.bridge.waitForSourceNotContains('| --- | --- |');
		const kinds = (await readDoc(page)).kinds;
		expect(kinds).toContain('admonitions/alert');
		expect(kinds).not.toContain('table');
		expect(await roundTripStable(page)).toBe(true);
	});
});

// An editor listing `admonitions({ convertAlertsOnPaste: true })` alone: the rewrite reads the whole
// paste, so a pasted alert lands as a `:::` box wherever 0.11.5's transform turned it into one.
test.describe('plugin admonitions: an alert pasted with the rewrite on', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions-alone');
	});

	test('a top-level alert lands as its box, undone in one step', async ({ page }) => {
		await editor.loadContent('Intro.\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard('> [!TIP]\n> Handy note.\n');
		await editor.paste();

		await editor.bridge.waitForSourceContains(':::tip\nHandy note.\n:::');
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'admonitions/admonition']);
		await editor.undo();
		await editor.bridge.waitForSourceEquals('Intro.\n');
	});

	test('one alert line pasted inside a paragraph lands as a box between its halves', async ({
		page
	}) => {
		await editor.loadContent('Intro text.\n');
		await editor.focusBlockAtPath([0], 5);
		await editor.seedClipboard('> [!NOTE]');
		await editor.paste();

		await editor.bridge.waitForSourceEquals('Intro\n\n:::note\n:::\n text.\n');
		expect((await readDoc(page)).kinds).toEqual([
			'paragraph',
			'admonitions/admonition',
			'paragraph'
		]);
	});

	test('an alert nested in a list item stays an alert', async ({ page }) => {
		await editor.loadContent('Intro.\n');
		await editor.focusBlockEnd(0);
		await editor.seedClipboard('- > [!NOTE]\n  > x\n');
		await editor.paste();

		await editor.bridge.waitForSourceContains('- > [!NOTE]\n  > x');
		expect(await editor.bridge.getSource()).not.toContain(':::');
		expect((await readDoc(page)).kinds).toContain('list');
	});
});
