import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { FIXTURE_BYTES } from '../perf/vr-helpers';

/**
 * Fold + block-badge fixtures (requirements/decorations/fold-and-badge.md). `fold` pins
 * ReplaceDecoration.widget with native interactivity inside the island, `block-badge` pins
 * BlockDecoration.badge including survival across windowing, and the fold-table seed pins
 * island rendering inside a table cell.
 */

const ISLAND = '[data-decoration-island]';
const FOLD_SEED = 'abc [>HIDDEN SECRET<] def\n\nplain text\n';
const FOLD_TABLE_SEED = '| a [>SECRET<] b | c |\n| --- | --- |\n| d | e |\n';

test.describe('fold fixture', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('fold');
	});

	test('the delimited range folds to one … island and never leaves getSource', async ({ page }) => {
		await expect(page.locator(`${ISLAND} .fold-ellipsis`)).toHaveText('…');
		await expect(editor.getBlock(0)).not.toContainText('HIDDEN SECRET');
		expect(await editor.bridge.getSource()).toBe(FOLD_SEED);
	});

	test('clicking the … island opens the fold; the source is untouched', async ({ page }) => {
		await page.locator(`${ISLAND} .fold-ellipsis`).click();
		await expect(page.locator(ISLAND)).toHaveCount(0);
		await expect(editor.getBlock(0)).toContainText('abc [>HIDDEN SECRET<] def');
		expect(await editor.bridge.getSource()).toBe(FOLD_SEED);
	});

	test('typing beside the folded range commits around the island', async ({ page }) => {
		await expect(page.locator(ISLAND)).toHaveCount(1);
		await editor.focusBlockEnd(0);
		await editor.typeSlowly('!');
		await editor.bridge.waitForSourceContains('def!');
		expect(await editor.bridge.getSource()).toBe('abc [>HIDDEN SECRET<] def!\n\nplain text\n');
	});
});

test.describe('fold fixture: islands in table cells', () => {
	// "Never dev-warns" rides the shared fixture: the retired cells-unsupported warning is a
	// `[aragonite:decorations]` sentinel fire, which the teardown watch fails undeclared.
	test('a fold range in a cell renders one … island, never dev-warns, and stays byte-safe', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('fold-table');
		await editor.bridge.waitForSourceContains('SECRET');

		// The cell surface now applies island decorations, exactly as the prose path.
		await editor.waitForRenderFlush();
		await expect(page.locator(`${ISLAND} .fold-ellipsis`)).toHaveText('…');
		await expect(page.getByRole('cell').first()).not.toContainText('SECRET');
		expect(await editor.bridge.getSource()).toBe(FOLD_TABLE_SEED);
	});

	test.describe('after the covered range is gone', () => {
		test('an edge press selects the cell fold island whole, then deletes its hidden range', async ({
			page
		}) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('fold-table');
			await editor.bridge.waitForSourceContains('SECRET');
			await editor.waitForRenderFlush();

			// Focus the island cell without clicking it (its left edge carries the row
			// grip, and the `…` opens the fold): enter the sibling cell and Shift+Tab back.
			await page.getByRole('cell').nth(1).click();
			await page.keyboard.press('Shift+Tab');
			await expect(page.getByRole('cell').first()).toBeFocused();
			await page.keyboard.press('Home');
			await page.keyboard.press('ArrowRight'); // past `a`
			await page.keyboard.press('ArrowRight'); // past the space → island leading edge

			// First Delete selects the whole island (a hidden byte is the only thing to
			// eat); the second deletes its covered range through the CST as one edit.
			await page.keyboard.press('Delete');
			await page.keyboard.press('Delete');

			await expect(page.locator(ISLAND)).toHaveCount(0);
			const source = await editor.bridge.getSource();
			expect(source).not.toContain('SECRET');
			// The covered bytes left getSource, and the row kept both columns.
			expect(source).toBe('| a  b | c |\n| --- | --- |\n| d | e |\n');
		});
	});
});

test.describe('block-badge fixture', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('badge');
	});

	test('heading hosts carry the class and badge widget; paragraphs carry neither', async ({
		page
	}) => {
		for (const heading of [0, 2]) {
			const host = page.locator(`[data-block-path='[${heading}]']`);
			await expect(host).toHaveClass(/badge-heading/);
			await expect(host.locator(':scope > .decoration-badge .badge-h')).toHaveCount(1);
		}
		for (const paragraph of [1, 3]) {
			const host = page.locator(`[data-block-path='[${paragraph}]']`);
			await expect(host).not.toHaveClass(/badge-heading/);
			await expect(host.locator(':scope > .decoration-badge')).toHaveCount(0);
		}
	});

	test('a badge survives its block windowing out and back in', async ({ page }) => {
		await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		const badge0 = page.locator("[data-block-path='[0]'] > .decoration-badge .badge-h");
		await expect(badge0).toHaveCount(1);

		const scrollHeight = await page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).scrollHeight
		);
		await editor.scrollEditorTo(scrollHeight);
		await expect(page.locator("[data-block-path='[0]']")).toHaveCount(0);

		await editor.scrollEditorTo(0);
		await expect(badge0).toHaveCount(1);
	});
});
