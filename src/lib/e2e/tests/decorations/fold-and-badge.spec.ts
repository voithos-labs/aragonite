import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { FIXTURE_BYTES } from '../perf/vr-helpers';

/**
 * Fold + block-badge fixtures (requirements/decorations/fold-and-badge.md).
 * `fold` pins ReplaceDecoration.widget with native interactivity inside the
 * island; `block-badge` pins BlockDecoration.badge, including survival across
 * windowing. The fold-table seed pins the islands-in-cells gap: the cell
 * surface applies no islands (docs/issues.md), and DEV warns at the source seam.
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
	test('a fold range in a cell renders no island, dev-warns, and stays byte-safe', async ({
		page
	}) => {
		const warnings: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'warning') warnings.push(msg.text());
		});
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('fold-table');
		await editor.bridge.waitForSourceContains('SECRET');

		// The cell surface applies no island decorations — the ledgered gap this
		// spec pins until the render path grows cell support.
		await editor.waitForRenderFlush();
		await expect(page.locator(ISLAND)).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(FOLD_TABLE_SEED);
		const islandWarn = (w: string) =>
			w.includes("source 'fold' places a replace island on a tableCell");
		await expect.poll(() => warnings.some(islandWarn)).toBe(true);
		// Exactly once per source+kind (the requirement's own wording): the seed holds
		// multiple provide runs, and the dedup must hold across all of them.
		expect(warnings.filter(islandWarn)).toHaveLength(1);
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
