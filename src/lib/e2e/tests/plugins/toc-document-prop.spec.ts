import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import { PluginsPage, readContainer } from './helpers';

/**
 * The outline dogfood is the named user of `BlockComponentProps.document`
 * (requirements/plugins/toc-document-prop.md). A `[[toc]]` block renders a `<nav>` list of the
 * document's headings read straight off the `document` prop, so these tests prove the prop is
 * delivered, stays current as a heading is edited, and reaches a nested block through the editor's
 * context. Seeds: `toc`, with headings and a top-level `[[toc]]`, and `toc-nested`, with headings
 * and a `[[toc]]` inside a blockquote.
 */
class TocPage extends PluginsPage {
	async gotoToc(seed: 'toc' | 'toc-nested' = 'toc'): Promise<void> {
		await this.gotoPlugins(seed);
		await expect(this.render.first()).toBeVisible();
	}

	get render(): Locator {
		return this.page.locator('.toc-block-render');
	}

	get source(): Locator {
		return this.page.locator('.toc-block-source');
	}

	/** Heading-list items of the top-level toc (block index 3 in the `toc` seed). */
	item(index: number): Locator {
		return this.page.locator("[data-block-path='[3]'] .toc-block-item").nth(index);
	}

	async itemTexts(): Promise<string[]> {
		return this.page.locator("[data-block-path='[3]'] .toc-block-item").allInnerTexts();
	}

	/** Heading-list items of the nested toc (blockquote child, path [2,0]). */
	nestedItem(index: number): Locator {
		return this.page.locator("[data-block-path='[2,0]'] .toc-block-item").nth(index);
	}

	/** Open the block's source by clicking away from any entry, on its border or padding, since a
	 *  click on an entry would navigate; the render swaps to the source. */
	async revealByClick(): Promise<void> {
		await this.render.click({ position: { x: 2, y: 2 } });
		await expect(this.source).toHaveCount(1);
	}
}

test.describe('toc dogfood: the document prop consumer', () => {
	let editor: TocPage;

	test.beforeEach(async ({ page }) => {
		editor = new TocPage(page);
		await editor.gotoToc('toc');
	});

	test('renders a folded list of the document headings, no source exposed', async () => {
		// Two ATX headings and one setext heading, marker-stripped, in document order.
		expect(await editor.itemTexts()).toEqual(['Overview', 'Details', 'Appendix']);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getBlockKind(3)).toBe('toc');
	});

	test('the document prop is live: editing a heading updates the folded list', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.typeSlowly('X');

		await expect(editor.item(0)).toHaveText('OverviewX');
		expect(await editor.itemTexts()).toEqual(['OverviewX', 'Details', 'Appendix']);
	});

	test('clicking the block (non-entry area) reveals the raw source without touching the CST', async () => {
		const before = await editor.bridge.getSource();
		await editor.revealByClick();

		await expect(editor.render).toHaveCount(0);
		expect((await editor.source.textContent()) ?? '').toBe('[[toc]]');
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('reveal → net-zero edit → blur folds back and round-trips the bytes', async ({ page }) => {
		const before = await editor.bridge.getSource();
		await editor.revealByClick();

		// Type a character and delete it back to `[[toc]]`: the commit only runs when the text
		// really changed, so closing the source only changes the view.
		await page.keyboard.press('End');
		await page.keyboard.type('x');
		await page.keyboard.press('Backspace');
		await editor.getBlock(0).click();

		await expect(editor.render).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('a document containing [[toc]] round-trips byte-for-byte through the editor', async () => {
		const doc = '# Title\n\n[[toc]]\n\nBody\n';
		await editor.loadContent(doc);
		expect(await editor.bridge.getSource()).toBe(doc);
		expect(await editor.bridge.getBlockKind(1)).toBe('toc');
	});
});

// The nested case: the prop is delivered through the editor's context, so it must reach a
// `[[toc]]` inside a container. A top-level scenario alone cannot show that it survives the nested
// render path, and this is the only test that covers it at runtime.
test.describe('toc dogfood: the document prop reaches nested depth', () => {
	let editor: TocPage;

	test.beforeEach(async ({ page }) => {
		editor = new TocPage(page);
		await editor.gotoToc('toc-nested');
	});

	test('a [[toc]] inside a blockquote lists the document headings and updates live', async ({
		page
	}) => {
		const quote = await readContainer(page, 2);
		expect(quote.kind).toBe('blockquote');
		expect(quote.childKinds).toEqual(['toc']);

		await expect(editor.nestedItem(0)).toHaveText('Chapter One');
		await expect(editor.nestedItem(1)).toHaveText('Section A');

		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await editor.typeSlowly('!');
		await expect(editor.nestedItem(0)).toHaveText('Chapter One!');
	});
});
