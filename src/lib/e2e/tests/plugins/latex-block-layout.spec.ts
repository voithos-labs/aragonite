import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';

// The layout toggle of an open math block and the room the block keeps, on both fence forms.
// Requirements: e2e/requirements/plugins/latex-block-layout.md.

const SEEDS = ['mathblock', 'mathfence'] as const;

// The toggle names the layout it switches to, so each click is read off the block's classes.
const CYCLE = [
	{ next: 'Preview below the source', layout: 'stacked' },
	{ next: 'Source only', layout: 'source' },
	{ next: 'Preview beside the source', layout: 'split' }
] as const;

class LayoutPage extends BlockMathPage {
	get toggle() {
		return this.page.locator('.math-preview-toggle');
	}

	async layout(): Promise<string> {
		return this.page.evaluate(() => {
			const block = document.querySelector('[data-block-path="[1]"] .math-block');
			if (!block?.classList.contains('math-block-editing')) return 'folded';
			if (block.classList.contains('math-block-split')) return 'split';
			return block.classList.contains('math-block-stacked') ? 'stacked' : 'source';
		});
	}

	async sourceFocused(): Promise<boolean> {
		return this.page.evaluate(() => document.activeElement?.closest('.math-block-source') !== null);
	}

	/** The room between the block host's edges and the cards it shows, above and below. */
	async room(): Promise<[number, number]> {
		return this.page.evaluate(() => {
			const host = document.querySelector('[data-block-path="[1]"]')!.getBoundingClientRect();
			const cards = [...document.querySelectorAll('[data-block-path="[1]"] .math-block-card')]
				.map((card) => card.getBoundingClientRect())
				.filter((box) => box.height > 0);
			const top = Math.min(...cards.map((box) => box.top));
			const bottom = Math.max(...cards.map((box) => box.bottom));
			return [top - host.top, host.bottom - bottom].map((v) => Math.round(v)) as [number, number];
		});
	}
}

for (const seed of SEEDS) {
	test.describe(`math block layout (${seed})`, () => {
		let editor: LayoutPage;

		test.beforeEach(async ({ page }) => {
			editor = new LayoutPage(page);
			await editor.gotoMathSeed(seed);
		});

		test('a toggle click keeps the open source, its text, the bytes and the undo depth', async ({
			page
		}) => {
			await editor.revealByClick();
			await page.keyboard.type('y');
			await expect(editor.source).toContainText('y');
			const shown = await editor.sourceText();
			const bytes = await editor.bridge.getSource();
			const depth = await editor.bridge.getUndoDepth();
			expect(await editor.layout()).toBe('split');

			for (const { next, layout } of CYCLE) {
				await expect(editor.toggle).toHaveAttribute('aria-label', next);
				await editor.toggle.click();
				await expect.poll(() => editor.layout()).toBe(layout);
				expect(await editor.sourceFocused()).toBe(true);
				expect(await editor.sourceText()).toBe(shown);
				expect(await editor.bridge.getSource()).toBe(bytes);
				expect(await editor.bridge.getUndoDepth()).toBe(depth);
			}

			await editor.getBlock(2).click();
			await expect.poll(() => editor.layout()).toBe('folded');
			expect(await editor.bridge.getSource()).not.toBe(bytes);
			expect(await editor.bridge.getSource()).toContain('y');
			expect(await editor.bridge.getUndoDepth()).toBe(depth + 1);
		});

		test('the block keeps 6px of room above and below, folded and open', async () => {
			expect(await editor.room()).toEqual([6, 6]);
			await editor.revealByClick();
			expect(await editor.room()).toEqual([6, 6]);
			for (const { layout } of CYCLE.slice(0, 2)) {
				await editor.toggle.click();
				await expect.poll(() => editor.layout()).toBe(layout);
				expect(await editor.room()).toEqual([6, 6]);
			}
		});
	});
}
