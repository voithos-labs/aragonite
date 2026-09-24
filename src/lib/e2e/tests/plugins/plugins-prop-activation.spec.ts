import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';

type Pane = 'listing' | 'notListing';

/** The harness route's read-only bridge over what each editor did with a chord. */
interface ActivationDoor {
	reserved(pane: Pane): string[];
	/** One entry per real keystroke: what each instance answered for that press. */
	claims(): { listing: boolean; notListing: boolean }[];
	/** Whether the pane's tree reloads as itself in that editor's own grammar. */
	converged(pane: Pane): boolean;
	/** The pane's document as Markdown. */
	source(pane: Pane): string;
}

const convergedIn = (page: Page, pane: Pane) =>
	page.evaluate(
		(p) => (window as unknown as { __activation: ActivationDoor }).__activation.converged(p),
		pane
	);

const sourceOf = (page: Page, pane: Pane) =>
	page.evaluate(
		(p) => (window as unknown as { __activation: ActivationDoor }).__activation.source(p),
		pane
	);

// Two editors over one seed: the first lists the parrot kind and the block-badge decoration
// source, the second lists neither. The definitions are shared by the whole process, so the only
// difference is which editor turned them on, and the `plugins` prop is that list
// (requirements/plugins/plugins-prop-activation.md).
test.describe('the plugins prop is the enablement set', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/activation');
		await page.getByTestId('editor-listing').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-not-listing').locator('[data-block-kind]').first().waitFor();
	});

	test('the listing editor renders the plugin component and its decorations', async ({ page }) => {
		const pane = page.getByTestId('editor-listing');
		await expect(pane.locator('[data-block-kind="parrot"] .parrot-block')).toBeVisible();
		await expect(pane.locator('[data-block-kind="parrot"] .raw-block')).toHaveCount(0);
		await expect(pane.locator('[data-block-kind="heading"] .badge-h')).toHaveCount(1);
	});

	test('reads the unlisted syntax as the prose it is', async ({ page }) => {
		const pane = page.getByTestId('editor-not-listing');
		await expect(pane.locator('[data-block-kind="parrot"]')).toHaveCount(0);
		await expect(pane.locator('[data-block-kind="paragraph"]').first()).toHaveText(
			/%%parrot party responsibly/
		);
	});

	test('both trees reload as themselves in their own grammar', async ({ page }) => {
		await page.waitForFunction(() => '__activation' in window);
		expect(await convergedIn(page, 'listing')).toBe(true);
		expect(await convergedIn(page, 'notListing')).toBe(true);
	});

	test('Enter before the unlisted fence leaves it prose that reloads as itself', async ({
		page
	}) => {
		await page.waitForFunction(() => '__activation' in window);
		const pane = page.getByTestId('editor-not-listing');
		await pane.getByText('%%parrot party responsibly').click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Enter');

		// The new empty paragraph, the parrot bytes, the note's body, the dollars and `Body`.
		await expect(pane.locator('[data-block-kind="paragraph"]')).toHaveCount(5);
		await expect(pane.locator('[data-block-kind="parrot"]')).toHaveCount(0);
		expect(await convergedIn(page, 'notListing')).toBe(true);
	});

	// GH #266: inline syntax, widgets and directive names reached every editor in the process.
	test('an unlisted inline plugin leaves its shortcode as text', async ({ page }) => {
		const listed = page.getByTestId('editor-listing').locator('[data-block-kind="heading"]');
		const unlisted = page.getByTestId('editor-not-listing').locator('[data-block-kind="heading"]');
		await expect(listed.locator('.md-emoji-widget')).toHaveCount(1);
		await expect(unlisted.locator('.md-emoji-widget')).toHaveCount(0);
		await expect(unlisted).toHaveText(/Heading :smile:/);
	});

	test('an unlisted directive name reads as the generic directive', async ({ page }) => {
		const listed = page.getByTestId('editor-listing');
		const unlisted = page.getByTestId('editor-not-listing');
		await expect(listed.locator('[data-block-kind="admonition"]')).toHaveCount(1);
		await expect(unlisted.locator('[data-block-kind="admonition"]')).toHaveCount(0);
		await expect(unlisted.locator('[data-block-kind="directiveContainer"]')).toHaveCount(1);
	});

	test('bold over dollars the editor draws as text wraps them in one run', async ({ page }) => {
		await page.waitForFunction(() => '__activation' in window);
		const pane = page.getByTestId('editor-not-listing');
		await pane.locator('[data-block-kind="paragraph"]').filter({ hasText: '$' }).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('ControlOrMeta+b');

		await expect.poll(() => sourceOf(page, 'notListing')).toContain('\n\n**$x$**\n\n');
		expect(await convergedIn(page, 'notListing')).toBe(true);
	});

	// The fixture fails at teardown on any dev invariant, so passing is the no-warning check.
	test('Enter inside the generic directive box commits without an invariant', async ({ page }) => {
		await page.waitForFunction(() => '__activation' in window);
		const box = page
			.getByTestId('editor-not-listing')
			.locator('[data-block-kind="directiveContainer"]');
		await box.getByText('Tip').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Z');

		await expect(box).toContainText('Z');
		expect(await convergedIn(page, 'notListing')).toBe(true);
	});

	// The badge comes from an onEditor hook, so its absence means the hook never ran here.
	test('attaches no decoration source from a plugin it did not list', async ({ page }) => {
		await expect(page.getByTestId('editor-not-listing').locator('.badge-h')).toHaveCount(0);
	});

	test('built-ins are untouched: both editors render their heading and body', async ({ page }) => {
		for (const testId of ['editor-listing', 'editor-not-listing']) {
			const pane = page.getByTestId(testId);
			await expect(pane.locator('[data-block-kind="heading"]')).toHaveCount(1);
			await expect(pane.locator('[data-block-kind="paragraph"]').last()).toHaveText('Body');
		}
	});
});

// The chord and paste halves of the same list. Each pane is the one that did not list what the
// other did: `editor-not-listing` lists `doc-stats`, whose global chord the parrot pane never
// asked for, and the parrot pane is the one that owns `%%parrot`.
test.describe('activation scopes the chord and the paste grammar', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/activation');
		await page.getByTestId('editor-listing').locator('[data-block-kind]').first().waitFor();
		await page.getByTestId('editor-not-listing').locator('[data-block-kind]').first().waitFor();
	});

	// GH #265: the chord was consumed for the whole process, so it died in the editor that never
	// listed the plugin instead of reaching the app around it.
	test('only the editor that listed the plugin claims its global chord', async ({ page }) => {
		// The panes render server-side, so waiting on a block only proves the markup arrived; the
		// bridge is an effect, and it exists once the page has hydrated.
		await page.waitForFunction(() => '__activation' in window);

		const reserved = await page.evaluate(() => {
			const door = (window as unknown as { __activation: ActivationDoor }).__activation;
			return {
				owner: door.reserved('notListing').includes('Mod+Shift+S'),
				other: door.reserved('listing').includes('Mod+Shift+S')
			};
		});
		expect(reserved).toEqual({ owner: true, other: false });

		await page
			.getByTestId('editor-not-listing')
			.locator('[data-block-kind="paragraph"]')
			.last()
			.click();
		await page.keyboard.press('ControlOrMeta+Shift+S');

		const answers = await page.evaluate(() =>
			(window as unknown as { __activation: ActivationDoor }).__activation.claims()
		);
		expect(answers.at(-1)).toEqual({ listing: false, notListing: true });
	});

	// GH #267: the clipboard parsed against the whole process, so `%%parrot` became a parrot block
	// in an editor that has no component for one.
	test('pasted plugin syntax lands as prose in the editor that omits the plugin', async ({
		page
	}) => {
		const pane = page.getByTestId('editor-not-listing');
		const body = pane.locator('[data-block-kind="paragraph"]').last();
		await body.click();
		await page.keyboard.press('End');

		await page.evaluate(() => navigator.clipboard.writeText('%%parrot dance\n'));
		await page.keyboard.press('ControlOrMeta+v');

		await expect(body).toHaveText(/%%parrot dance/);
		await expect(pane.locator('[data-block-kind="parrot"]')).toHaveCount(0);
	});
});
