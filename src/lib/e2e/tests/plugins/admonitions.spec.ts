import { test, expect } from '../../fixtures';
import { primaryModifier } from '../../platform';
import { PluginsPage, readContainer, readDoc, roundTripStable } from './helpers';

/**
 * Admonitions dogfood battery. Five directive names resolve to one `admonition` kind that reads its
 * variant from metadata; child 0 is the editable title chrome leaf, and the opener line is rebuilt
 * from children + metadata. The composed harness gives `note`/`warning` to the callout dogfood, so
 * every scenario drives an admonition-owned kind. The uninstalled-fallback path is unit-covered
 * (admonitions-fallback.test.ts).
 */

test.describe('plugin admonitions', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
		// Three `:::name` directive admonitions plus one native `> [!CAUTION]` alert,
		// all drawn by the shared component but tagged by their source.
		await expect(page.locator(".admonition[data-alert-source='directive']")).toHaveCount(3);
		await expect(page.locator(".admonition[data-alert-source='github']")).toHaveCount(1);
	});

	test('the seeded kinds each render a box carrying their own data-kind', async ({ page }) => {
		// Distinct per-kind rendering is the signal a reader tells the kinds apart by.
		for (const kind of ['important', 'tip', 'caution']) {
			await expect(
				page.locator(`.admonition[data-alert-source='directive'][data-kind='${kind}']`)
			).toHaveCount(1);
		}
		// The native alert renders the same styled box, keyed off its own metadata.
		await expect(
			page.locator(".admonition[data-alert-source='github'][data-kind='caution']")
		).toHaveCount(1);
	});

	test('a titled admonition shows its title; an untitled one shows the kind placeholder', async ({
		page
	}) => {
		// Titled: the chrome leaf renders the opener-line title verbatim.
		await expect(page.locator(".admonition[data-kind='tip'] .admonition-title")).toHaveText(
			'Pro tip'
		);
		expect((await readContainer(page, 2)).childTexts[0]).toBe('Pro tip');

		// Untitled: the title leaf is empty and the box flags it, so the capitalized
		// kind name stands in as a placeholder (a CSS ::after, not real title bytes).
		const box = page.locator(".admonition[data-kind='important']");
		await expect(box).toHaveAttribute('data-title-empty', 'true');
		expect((await readContainer(page, 1)).childTexts[0]).toBe('');
		const placeholder = await box
			.locator('.admonition-title')
			.evaluate((el) => getComputedStyle(el, '::after').content);
		expect(placeholder).toContain('Important');
	});

	test('typing into the untitled title fills the placeholder and rewrites the opener', async ({
		page
	}) => {
		await editor.focusBlockAtPath([1, 0], 0);
		await editor.typeText('Read me');

		await editor.bridge.waitForSourceContains(':::important Read me');
		// The placeholder is gone: the box no longer flags the title empty.
		await expect(page.locator(".admonition[data-kind='important']")).toHaveAttribute(
			'data-title-empty',
			'false'
		);
		expect((await readContainer(page, 1)).childTexts[0]).toBe('Read me');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('Mod+7 advances the kind in one undoable commit, restored by Ctrl+Z', async ({ page }) => {
		// A real chord on the tip admonition's body cycles it forward to important.
		await editor.focusBlockAtPath([2, 1], 0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await page.keyboard.press(`${primaryModifier}+7`);

		await editor.bridge.waitForSourceContains(':::important Pro tip');
		await editor.bridge.waitForSourceNotContains(':::tip');
		// Exactly one metadata commit per press — no split, no input op.
		const ops = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		expect(ops).toEqual(['metadataUpdate']);
		expect(await roundTripStable(page)).toBe(true);

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::tip Pro tip');
		expect((await readContainer(page, 2)).raw).toBe(':::tip Pro tip\nA titled tip.\n:::\n');
	});

	test('the convert button rewrites the native alert to a directive, spares the fenced one, then disables', async ({
		page
	}) => {
		const convert = page.getByTestId('convert-alerts');
		// Precondition: a native alert exists (a `githubAlert`, not a plain blockquote) → enabled.
		await expect(convert).toBeEnabled();
		expect((await readDoc(page)).kinds[5]).toBe('githubAlert');

		await convert.click();

		await editor.bridge.waitForSourceContains(':::caution\nStill a blockquote alert.\n:::');
		expect((await readDoc(page)).kinds[5]).toBe('admonition');
		await expect(page.locator(".admonition[data-alert-source='directive']")).toHaveCount(4);
		await expect(page.locator(".admonition[data-alert-source='github']")).toHaveCount(0);

		// Selectivity: the `> [!NOTE]` inside the code fence is left byte-identical —
		// never converted to `:::note` — because only top-level alerts convert.
		const source = await editor.bridge.getSource();
		expect(source).toContain('```markdown\n> [!NOTE]\n> Inside a fence — must not convert.\n```');
		expect(source).not.toContain(':::note');
		expect((await readDoc(page)).kinds[6]).toBe('fencedCode');

		// Nothing convertible remains, so the affordance disables itself.
		await expect(convert).toBeDisabled();
		expect(await roundTripStable(page)).toBe(true);
	});
});
