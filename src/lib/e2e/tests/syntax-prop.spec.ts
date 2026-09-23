import { test, expect } from '../fixtures';
import { type Page } from '@playwright/test';

// Two editors over one seed, one with `syntax={{ indentedCode: false, setextHeading: false }}`.
// Requirements: `e2e/requirements/syntax-prop.md`.

type Pane = 'off' | 'on';

const SEED = 'Loaded\n\n\tcode\n\nPlan\n---\n';

const sourceOf = (page: Page, pane: Pane) =>
	page.evaluate((p) => (window as any).__syntax.source(p) as string, pane);
const divergenceOf = (page: Page, pane: Pane) =>
	page.evaluate((p) => (window as any).__syntax.divergence(p) as string | null, pane);
const paneOf = (page: Page, pane: Pane) => page.getByTestId(`editor-${pane}`);
const kindsIn = (page: Page, pane: Pane) =>
	paneOf(page, pane)
		.locator('[data-block-path]:not([data-block-path*=","])')
		.evaluateAll((els) => els.map((el) => el.getAttribute('data-block-kind')));

/** An empty paragraph under `Loaded`, focused: End on the first block, then Enter. */
async function openLineUnderFirst(page: Page, pane: Pane): Promise<void> {
	await paneOf(page, pane).getByText('Loaded').click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
}

async function expectBothConverge(page: Page): Promise<void> {
	expect(await divergenceOf(page, 'off')).toBeNull();
	expect(await divergenceOf(page, 'on')).toBeNull();
}

test.describe('the syntax prop switches a syntax off in one editor', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/syntax');
		await page.waitForFunction(() => '__syntax' in window);
		await paneOf(page, 'off').locator('[data-block-kind]').first().waitFor();
		await paneOf(page, 'on').locator('[data-block-kind]').first().waitFor();
	});

	test('a loaded file reads differently and keeps its bytes in both', async ({ page }) => {
		expect(await kindsIn(page, 'off')).toEqual([
			'paragraph',
			'paragraph',
			'paragraph',
			'thematicBreak'
		]);
		expect(await kindsIn(page, 'on')).toEqual(['paragraph', 'indentedCode', 'setextHeading']);
		expect(await sourceOf(page, 'off')).toBe(SEED);
		expect(await sourceOf(page, 'on')).toBe(SEED);
		await expectBothConverge(page);
	});

	test('Tab then `notes` is prose in one editor and code in the other', async ({ page }) => {
		for (const pane of ['off', 'on'] as const) {
			await openLineUnderFirst(page, pane);
			await page.keyboard.press('Tab');
			await page.keyboard.type('notes');
		}

		const typed = 'Loaded\n\n\tnotes\n\n\tcode\n\nPlan\n---\n';
		expect(await sourceOf(page, 'off')).toBe(typed);
		expect(await sourceOf(page, 'on')).toBe(typed);
		expect((await kindsIn(page, 'off'))[1]).toBe('paragraph');
		expect((await kindsIn(page, 'on'))[1]).toBe('indentedCode');
		await expectBothConverge(page);
	});

	test('typing into the loaded `Plan` leaves the divider under it a divider', async ({ page }) => {
		await paneOf(page, 'off').getByText('Plan').click();
		await page.keyboard.press('End');
		await page.keyboard.type('s');

		expect(await sourceOf(page, 'off')).toBe('Loaded\n\n\tcode\n\nPlans\n---\n');
		expect((await kindsIn(page, 'off')).slice(2)).toEqual(['paragraph', 'thematicBreak']);
		await expectBothConverge(page);
	});

	test('Enter before the tab of the loaded `code` line leaves a paragraph', async ({ page }) => {
		await paneOf(page, 'off').getByText('code').click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Enter');

		expect(await sourceOf(page, 'off')).toBe('Loaded\n\n\n\tcode\n\nPlan\n---\n');
		expect(await kindsIn(page, 'off')).not.toContain('indentedCode');
		await expectBothConverge(page);
	});

	// The pasted blocks land as blocks of their own, so the editor that reads two puts a blank
	// line between them; the one that reads a heading keeps it whole.
	test('`Plan` over `---` pasted is text and a divider in one editor, a heading in the other', async ({
		page
	}) => {
		for (const pane of ['off', 'on'] as const) {
			await openLineUnderFirst(page, pane);
			await page.evaluate(() => navigator.clipboard.writeText('Plan\n---\n'));
			await page.keyboard.press('ControlOrMeta+v');
		}

		expect(await sourceOf(page, 'off')).toBe('Loaded\n\nPlan\n\n---\n\n\tcode\n\nPlan\n---\n');
		expect(await sourceOf(page, 'on')).toBe('Loaded\n\nPlan\n---\n\n\tcode\n\nPlan\n---\n');
		expect((await kindsIn(page, 'off')).slice(1, 3)).toEqual(['paragraph', 'thematicBreak']);
		expect((await kindsIn(page, 'on'))[1]).toBe('setextHeading');
		await expectBothConverge(page);
	});
});
