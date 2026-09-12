import { test, expect } from '../../../fixtures';
import { PluginsPage } from '../../plugins/helpers';
import { waitForFirstImageLoaded } from './helpers';

// A selected image is a whole-block stop like a divider or an equation: a plain vertical arrow
// leaves it for the block above or below, the way the horizontal arrows already step out of it.
// Requirements: e2e/requirements/blocks/image/selected-image-vertical-arrows.md.

const IMAGE = '![pic|120x120](/test-fixtures/sample.png)';
const TOP_LEVEL = `above\n\n${IMAGE}\n\nbelow\n`;
const IN_DETAILS = `above\n\n<details open>\n<summary>Sum</summary>\n\n${IMAGE}\n\n</details>\n\nbelow\n`;
const PLACEMENTS = [
	['top level', TOP_LEVEL],
	['a details body', IN_DETAILS]
] as const;

async function selectImage(editor: PluginsPage): Promise<void> {
	await waitForFirstImageLoaded(editor.page);
	await editor.page.locator('[data-image-widget]').first().click();
	await expect(editor.page.locator('[data-image-overlay]')).toHaveCount(1);
}

/** The typed X sits in `expected` and nowhere near the image's bytes. */
function expectTypedInto(src: string, line: string, expected: string): void {
	expect(line.replace('X', '')).toBe(expected);
	expect(line).toContain('X');
	expect(src).not.toMatch(/!\[pic[^\n]*X|X[^\n]*\(\/test-fixtures/);
}

for (const mode of ['source', 'live'] as const) {
	for (const [placement, doc] of PLACEMENTS) {
		test.describe(`selected image, vertical arrows: ${mode} mode, ${placement}`, () => {
			let editor: PluginsPage;

			test.beforeEach(async ({ page }) => {
				editor = new PluginsPage(page);
				await editor.gotoPlugins();
				await editor.loadContent(doc);
				await editor.setPresentationMode(mode);
			});

			test('ArrowDown leaves the selected image for the block below', async ({ page }) => {
				await selectImage(editor);
				await page.keyboard.press('ArrowDown');
				await editor.typeText('X');
				const src = await editor.bridge.getSource();
				expectTypedInto(src, src.trimEnd().split('\n').pop()!, 'below');
			});

			test('ArrowUp leaves the selected image for the block above', async ({ page }) => {
				await selectImage(editor);
				await page.keyboard.press('ArrowUp');
				await editor.typeText('X');
				const src = await editor.bridge.getSource();
				// Inside a details the block above the first body child is the summary row, the
				// same landing a paragraph there gets.
				const lines = src.split('\n');
				const above = placement === 'top level' ? lines[0] : lines[3];
				expectTypedInto(src, above, placement === 'top level' ? 'above' : '<summary>Sum</summary>');
			});
		});
	}
}
