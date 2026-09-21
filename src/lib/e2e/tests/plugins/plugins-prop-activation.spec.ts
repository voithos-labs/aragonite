import { test, expect } from '../../fixtures';

type Pane = 'listing' | 'notListing';

/** The harness route's read-only bridge over what each editor did with a chord. */
interface ActivationDoor {
	reserved(pane: Pane): string[];
	/** One entry per real keystroke: what each instance answered for that press. */
	claims(): { listing: boolean; notListing: boolean }[];
}

// Two editors over one seed: the first lists the parrot kind and the block-badge decoration
// source, the second lists neither. The definitions are shared by the whole process, so the only
// difference is which editor turned them on, and the `plugins` prop is that list
// (requirements/plugins/plugins-prop-activation.md). Falling back to raw text is what happens with
// no component, and it warns on the way past, so every load of this route warns once.
test.describe('the plugins prop is the enablement set', () => {
	test.use({ expectWarns: ['block-host'] });

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

	test('degrades the unlisted kind to raw-editable', async ({ page }) => {
		const parrot = page.getByTestId('editor-not-listing').locator('[data-block-kind="parrot"]');
		await expect(parrot).toBeVisible();
		await expect(parrot.locator('.raw-block')).toBeVisible();
		await expect(parrot.locator('.parrot-block')).toHaveCount(0);
		await expect(parrot).toHaveText(/%%parrot party responsibly/);
	});

	// The badge comes from an onEditor hook, so its absence means the hook never ran here.
	test('attaches no decoration source from a plugin it did not list', async ({ page }) => {
		await expect(page.getByTestId('editor-not-listing').locator('.badge-h')).toHaveCount(0);
	});

	test('built-ins are untouched: both editors render their heading and body', async ({ page }) => {
		for (const testId of ['editor-listing', 'editor-not-listing']) {
			const pane = page.getByTestId(testId);
			await expect(pane.locator('[data-block-kind="heading"]')).toHaveCount(1);
			await expect(pane.locator('[data-block-kind="paragraph"]')).toHaveCount(1);
		}
	});
});

// The chord and paste halves of the same list. Each pane is the one that did not list what the
// other did: `editor-not-listing` lists `doc-stats`, whose global chord the parrot pane never
// asked for, and the parrot pane is the one that owns `%%parrot`.
test.describe('activation scopes the chord and the paste grammar', () => {
	test.use({ expectWarns: ['block-host'] });

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

		await page.getByTestId('editor-not-listing').locator('[data-block-kind="paragraph"]').click();
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
		const body = pane.locator('[data-block-kind="paragraph"]');
		await body.click();
		await page.keyboard.press('End');

		await page.evaluate(() => navigator.clipboard.writeText('%%parrot dance\n'));
		await page.keyboard.press('ControlOrMeta+v');

		await expect(body).toHaveText(/%%parrot dance/);
		// Still only the seed's parrot, which renders as the raw fallback here.
		await expect(pane.locator('[data-block-kind="parrot"]')).toHaveCount(1);
	});
});
